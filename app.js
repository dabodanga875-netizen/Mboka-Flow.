/* Mboka Flow prototype: map, place search, route planning and local demo reports.
   External services are used; production traffic and road status are not guaranteed. */
const KINSHASA = [-4.325, 15.322];
const map = L.map('map', { zoomControl: true }).setView(KINSHASA, 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let currentPosition = null;
let startPoint = null;
let endPoint = null;
let startMarker = null;
let endMarker = null;
let routeLayer = null;
let reportMarkers = [];
let pendingReportPoint = null;
let searchPins = [];
const routeBtn = document.getElementById('routeBtn');
const routeInfo = document.getElementById('routeInfo');
const mapStatus = document.getElementById('mapStatus');

document.getElementById('year').textContent = new Date().getFullYear();

function fmtCoord(p){return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;}
function setMarker(which, point, label) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="background:${which==='start'?'#0b6b53':'#1769e0'};color:white;border:2px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);width:23px;height:23px;box-shadow:0 2px 7px #0004"><span style="display:block;transform:rotate(45deg);text-align:center;font-size:11px;font-weight:bold;line-height:19px">${which==='start'?'D':'A'}</span></div>`,
    iconSize:[23,23], iconAnchor:[11,22]
  });
  const marker = L.marker(point, {icon}).addTo(map).bindPopup(`${label}<br>${fmtCoord(point)}`);
  if (which === 'start') { if(startMarker) map.removeLayer(startMarker); startMarker=marker; startPoint=point; }
  else { if(endMarker) map.removeLayer(endMarker); endMarker=marker; endPoint=point; }
  routeBtn.disabled = !(startPoint && endPoint);
}
function clearRoute() {
  if(routeLayer) map.removeLayer(routeLayer);
  routeLayer=null;
  if(startMarker) map.removeLayer(startMarker);
  if(endMarker) map.removeLayer(endMarker);
  startMarker=endMarker=null; startPoint=endPoint=null;
  routeBtn.disabled=true;
  routeInfo.textContent='Aucun itinéraire calculé.';
}
map.on('click', e => {
  pendingReportPoint = e.latlng;
  mapStatus.textContent = `Point sélectionné : ${fmtCoord(e.latlng)}. Pour un itinéraire, choisissez Départ ou Arrivée dans les résultats, ou utilisez Ma position.`;
  document.getElementById('reportStatus').textContent = `Point de signalement sélectionné : ${fmtCoord(e.latlng)}`;
});

document.getElementById('locateBtn').addEventListener('click', () => {
  mapStatus.textContent='Demande de position GPS…';
  if (!navigator.geolocation) { mapStatus.textContent='La géolocalisation n’est pas disponible sur cet appareil.'; return; }
  navigator.geolocation.getCurrentPosition(pos => {
    currentPosition = L.latLng(pos.coords.latitude, pos.coords.longitude);
    map.setView(currentPosition, 15);
    L.circleMarker(currentPosition, {radius:8,color:'#fff',weight:3,fillColor:'#0b6b53',fillOpacity:1}).addTo(map)
      .bindPopup('Votre position GPS (approximative selon le signal)').openPopup();
    setMarker('start', currentPosition, 'Départ');
    mapStatus.textContent='Position obtenue. Choisissez une destination pour calculer un itinéraire.';
  }, err => {
    mapStatus.textContent = err.code===1 ? 'Autorisez la localisation dans votre navigateur, puis réessayez.' : 'Position indisponible. Vérifiez le GPS et réessayez.';
  }, {enableHighAccuracy:true, timeout:12000, maximumAge:30000});
});

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=cd&q=${encodeURIComponent(q + ', Kinshasa, Democratic Republic of the Congo')}`;
  const res = await fetch(url, {headers:{'Accept':'application/json'}});
  if(!res.ok) throw new Error('La recherche de lieux est temporairement indisponible.');
  return await res.json();
}
document.getElementById('searchBtn').addEventListener('click', async () => {
  const q = document.getElementById('destination').value.trim();
  const box = document.getElementById('searchResults');
  if(!q){box.textContent='Saisissez un lieu à rechercher.';return;}
  box.textContent='Recherche en cours…';
  try {
    const items = await geocode(q);
    box.replaceChildren();
    if(!items.length){box.textContent='Aucun résultat trouvé. Essayez un nom de quartier ou un lieu connu.';return;}
    items.forEach(item => {
      const btn=document.createElement('button'); btn.className='result-item';
      const title=document.createElement('span'); title.textContent=item.display_name.split(',').slice(0,3).join(',');
      const details=document.createElement('span'); details.textContent='Choisir comme arrivée · ou utiliser comme départ';
      btn.append(title,details);
      btn.addEventListener('click', () => {
        const p=L.latLng(Number(item.lat),Number(item.lon));
        setMarker('end',p,'Destination');
        map.setView(p,15); endMarker.openPopup();
        box.querySelectorAll('.result-item').forEach(x=>x.style.borderColor='#dce7e2');
        btn.style.borderColor='#0b6b53';
        if(!startPoint) mapStatus.textContent='Destination choisie. Appuyez sur Ma position ou choisissez un départ sur la carte.';
        else mapStatus.textContent='Destination choisie. Vous pouvez calculer l’itinéraire.';
      });
      box.appendChild(btn);
    });
  } catch(e){box.textContent=e.message || 'Erreur de recherche. Réessayez.';}
});

document.getElementById('routeBtn').addEventListener('click', async () => {
  if(!startPoint || !endPoint) return;
  routeInfo.textContent='Calcul de l’itinéraire…';
  const url=`https://router.project-osrm.org/route/v1/driving/${startPoint.lng},${startPoint.lat};${endPoint.lng},${endPoint.lat}?overview=full&geometries=geojson&steps=true`;
  try{
    const res=await fetch(url);
    const data=await res.json();
    if(!res.ok || data.code!=='Ok' || !data.routes?.length) throw new Error('Aucun itinéraire disponible entre ces points.');
    const r=data.routes[0];
    if(routeLayer) map.removeLayer(routeLayer);
    routeLayer=L.geoJSON(r.geometry,{style:{color:'#1769e0',weight:6,opacity:.85}}).addTo(map);
    map.fitBounds(routeLayer.getBounds(),{padding:[35,35]});
    const km=(r.distance/1000).toFixed(1);
    const mins=Math.round(r.duration/60);
    routeInfo.innerHTML=`<strong>Itinéraire calculé</strong><br>Distance estimée : ${km} km<br>Durée théorique : ${mins} min<br><span class="muted">Cette estimation ne reflète pas nécessairement le trafic ou l’état réel des routes.</span>`;
    mapStatus.textContent='Itinéraire affiché. Vérifiez les conditions réelles avant de partir.';
  }catch(e){routeInfo.textContent=e.message || 'Impossible de calculer cet itinéraire pour le moment.';}
});
document.getElementById('clearBtn').addEventListener('click',()=>{
  clearRoute();
  document.getElementById('searchResults').replaceChildren();
  mapStatus.textContent='Itinéraire effacé. Cliquez sur la carte pour choisir un point.';
});

document.getElementById('reportBtn').addEventListener('click',()=>{
  const p=pendingReportPoint || (currentPosition || null);
  const status=document.getElementById('reportStatus');
  if(!p){status.textContent='Cliquez d’abord sur la carte pour choisir l’endroit du problème, ou utilisez Ma position.';return;}
  const type=document.getElementById('issueType').value;
  const note=document.getElementById('issueNote').value.trim();
  const when=new Date().toLocaleString('fr-FR');
  const marker=L.circleMarker(p,{radius:8,color:'#fff',weight:2,fillColor:'#16a36a',fillOpacity:1}).addTo(map);
  marker.bindPopup(`<strong>Signalement de démonstration</strong><br>${escapeHtml(type)}<br>${escapeHtml(note || 'Aucun détail fourni')}<br><small>${escapeHtml(when)}</small><br><em>Non partagé avec d’autres utilisateurs.</em>`);
  reportMarkers.push(marker);
  status.textContent=`Signalement de démonstration ajouté à la carte : ${type}. Il reste local à cette session et n’est pas transmis.`;
  pendingReportPoint=null;
});
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
