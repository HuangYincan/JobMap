---
name: amap-api-integration
description: Integrate AMap (高德地图) JavaScript API v2.0 for map rendering, POI search, geocoding, and spatial features.
---

# AMap API Integration Guide

Integrate AMap (高德地图) JavaScript API v2.0 following official documentation at https://lbs.amap.com/api/javascript-api-v2/summary and Domain Map's architecture patterns.

## Official Resources

**Primary Documentation:**
- API Summary: https://lbs.amap.com/api/javascript-api-v2/summary
- Getting Started: https://lbs.amap.com/api/javascript-api-v2/guide/abc/prepare
- API Reference: https://lbs.amap.com/api/javascript-api-v2/documentation
- Examples: https://lbs.amap.com/demo/javascript-api-v2/example/map/map-show

**Key Sections:**
- Map Display: https://lbs.amap.com/api/javascript-api-v2/guide/abc/quickstart
- POI Search: https://lbs.amap.com/api/javascript-api-v2/guide/services/search
- Geocoding: https://lbs.amap.com/api/javascript-api-v2/guide/services/geocoder
- Markers: https://lbs.amap.com/api/javascript-api-v2/guide/overlays/marker
- Events: https://lbs.amap.com/api/javascript-api-v2/guide/events/map-event

## Before Starting

1. **API Key Setup**
   - Register at https://lbs.amap.com/
   - Create JavaScript API application
   - Configure allowed domains (localhost for dev)
   - Get Security Code (防止盗用)
   - Store in `.env.local`:
     ```bash
     NEXT_PUBLIC_AMAP_KEY=your_key_here
     NEXT_PUBLIC_AMAP_SECURITY_CODE=your_code_here
     ```

2. **Check Existing Implementation**
   - Review `src/components/map-shell.tsx` for current usage
   - Check `src/lib/map-adapter.ts` for adapter pattern
   - Review environment setup in `server/docs/environment-variables.md`

3. **Understand Quota Limits**
   - Free tier: 300,000 requests/day
   - POI search: 100,000 requests/day
   - Monitor usage in console: https://console.amap.com/

## Basic Setup

### 1. Load AMap Script

```typescript
// components/map-shell.tsx (existing pattern)
useEffect(() => {
  const apiKey = process.env.NEXT_PUBLIC_AMAP_KEY;
  const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE;

  if (!apiKey || !securityCode) {
    console.warn('AMap credentials missing');
    return;
  }

  // Set security config BEFORE loading script
  window._AMapSecurityConfig = {
    securityJsCode: securityCode,
  };

  // Load AMap script
  if (!window.AMap) {
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${apiKey}`;
    script.async = true;
    script.onload = () => initMap();
    script.onerror = () => console.error('AMap script failed to load');
    document.head.appendChild(script);
  } else {
    initMap();
  }
}, []);
```

### 2. Initialize Map

```typescript
function initMap() {
  if (!window.AMap || mapInstance.current) return;

  mapInstance.current = new AMap.Map('map-container', {
    // Position
    center: [120.15, 30.27],  // [lng, lat] - Hangzhou
    zoom: 13,

    // View settings
    viewMode: '3D',           // '2D' or '3D'
    pitch: 0,                 // 0-83 degrees (3D tilt)
    rotation: 0,              // 0-360 degrees
    
    // Zoom controls
    zooms: [3, 20],           // Min/max zoom levels
    
    // Map style
    mapStyle: 'amap://styles/normal',  // or 'whitesmoke' (dark)
    
    // Features
    features: ['bg', 'road', 'building', 'point'],  // Map layers
    
    // Controls (manual control preferred)
    showLabel: true,          // Show POI labels
    showIndoorMap: false,     // Disable indoor maps
    
    // Performance
    isHotspot: false,         // Disable POI hotspots
    defaultCursor: 'default',
  });

  // Wait for map to be ready
  mapInstance.current.on('complete', () => {
    console.log('Map loaded');
    onMapReady();
  });
}
```

## Map Interactions

### Viewport Control

```typescript
// Fly to location with animation
map.flyTo({
  center: [lng, lat],
  zoom: 16,
  pitch: 45,
  rotation: 0,
  duration: 800,  // milliseconds
});

// Set center without animation
map.setCenter([lng, lat]);
map.setZoom(15);

// Get current state
const center = map.getCenter();  // { lng: number, lat: number }
const zoom = map.getZoom();      // number
const bounds = map.getBounds();  // { southwest, northeast }

// Fit bounds to show all markers
const bounds = new AMap.Bounds(
  [minLng, minLat],
  [maxLng, maxLat]
);
map.setBounds(bounds);
```

### 3D Controls

```typescript
// Set pitch (tilt angle)
map.setPitch(45);  // 0-83 degrees

// Set rotation (compass bearing)
map.setRotation(90, true, 300);  // (angle, smooth, duration)

// Get current rotation
const rotation = map.getRotation();  // 0-360

// Middle-button drag for 3D control (existing implementation)
let isDragging = false;
let startX = 0, startY = 0;

map.on('mousedown', (e) => {
  if (e.originEvent.button === 1) {  // Middle button
    isDragging = true;
    startX = e.pixel.x;
    startY = e.pixel.y;
    document.body.style.cursor = 'grabbing';
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;

  const deltaX = e.clientX - startX;
  const deltaY = e.clientY - startY;

  // Rotation (X-axis drag)
  const currentRotation = map.getRotation();
  const newRotation = (currentRotation + deltaX * 0.13) % 360;
  map.setRotation(newRotation, false);

  // Pitch (Y-axis drag)
  const currentPitch = map.getPitch();
  const newPitch = Math.max(0, Math.min(83, currentPitch - deltaY * 0.15));
  map.setPitch(newPitch);

  startX = e.clientX;
  startY = e.clientY;
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    document.body.style.cursor = 'default';
  }
});
```

## Markers & Overlays

### Basic Marker

```typescript
// Create marker
const marker = new AMap.Marker({
  position: [lng, lat],
  title: 'Marker Title',
  
  // Icon (optional, default is red pin)
  icon: new AMap.Icon({
    size: new AMap.Size(25, 34),
    image: '/marker-icon.png',
    imageSize: new AMap.Size(25, 34),
  }),
  
  // Or use data URI for inline SVG
  icon: 'data:image/svg+xml,...',
  
  // Style
  offset: new AMap.Pixel(-13, -34),  // Adjust anchor point
  zIndex: 100,
  
  // Interaction
  clickable: true,
  draggable: false,
  cursor: 'pointer',
  
  // Custom data
  extData: { id: 'poi-123', type: 'restaurant' },
});

// Add to map
map.add(marker);

// Marker events
marker.on('click', (e) => {
  const data = marker.getExtData();
  handleMarkerClick(data.id);
});

marker.on('mouseover', () => {
  marker.setAnimation('AMAP_ANIMATION_BOUNCE');
});

marker.on('mouseout', () => {
  marker.setAnimation('AMAP_ANIMATION_NONE');
});

// Update marker
marker.setPosition([newLng, newLat]);
marker.setIcon(newIcon);

// Remove marker
map.remove(marker);
```

### Marker Clustering

```typescript
// Import cluster plugin (add to script src)
// ?v=2.0&key=...&plugin=AMap.MarkerCluster

// Create cluster
const cluster = new AMap.MarkerCluster(map, markers, {
  gridSize: 60,       // Cluster grid size (px)
  maxZoom: 16,        // Max zoom for clustering
  
  // Cluster style
  styles: [{
    url: '/cluster-icon.png',
    size: new AMap.Size(53, 52),
    offset: new AMap.Pixel(-26, -26),
    textColor: '#fff',
    textSize: 14,
  }],
  
  // Render cluster text (count)
  renderClusterMarker: (context) => {
    const count = context.count;
    context.marker.setLabel({
      content: `${count}`,
      offset: new AMap.Pixel(-10, -10),
    });
  },
});

// Add click event to clusters
cluster.on('click', (e) => {
  const zoom = map.getZoom();
  if (zoom < 18) {
    map.setZoom(zoom + 2);
    map.setCenter(e.lnglat);
  }
});
```

### Circle (Distance Buffer)

```typescript
const circle = new AMap.Circle({
  center: [lng, lat],
  radius: 5000,  // meters
  
  // Style
  fillColor: 'rgba(0, 122, 255, 0.1)',
  strokeColor: '#007AFF',
  strokeWeight: 2,
  strokeStyle: 'solid',
  
  // Interaction
  cursor: 'default',
  clickable: false,
  zIndex: 10,
});

map.add(circle);

// Update radius
circle.setRadius(10000);

// Make draggable for user adjustment
circle.setDraggable(true);
circle.on('dragend', () => {
  const newCenter = circle.getCenter();
  onBufferChange(newCenter, circle.getRadius());
});
```

### Info Window

```typescript
const infoWindow = new AMap.InfoWindow({
  content: '<div class="info-window"><h3>Title</h3><p>Content</p></div>',
  offset: new AMap.Pixel(0, -34),
  
  // Style
  isCustom: false,  // true for custom styled window
  closeWhenClickMap: true,
  autoMove: true,   // Auto adjust position
});

// Show at marker
marker.on('click', () => {
  infoWindow.open(map, marker.getPosition());
});

// Show at lnglat
infoWindow.open(map, [lng, lat]);

// Close
infoWindow.close();
```

## POI Search

### Text Search

```typescript
// Import PlaceSearch plugin (add to script src)
// ?v=2.0&key=...&plugin=AMap.PlaceSearch

// Create search instance
const placeSearch = new AMap.PlaceSearch({
  city: '杭州',        // Search in city
  pageSize: 20,        // Results per page
  pageIndex: 1,        // Page number (1-based)
  extensions: 'all',   // 'base' or 'all' (detailed info)
  
  // Auto show results on map (optional)
  map: map,
  panel: 'search-results',  // DOM id for result list
});

// Search by keyword
placeSearch.search('星巴克', (status, result) => {
  if (status === 'complete' && result.info === 'OK') {
    const pois = result.poiList.pois;
    
    pois.forEach(poi => {
      console.log({
        id: poi.id,
        name: poi.name,
        type: poi.type,
        address: poi.address,
        location: poi.location,  // { lng, lat }
        tel: poi.tel,
        photos: poi.photos,
        rating: poi.biz_ext?.rating,
        cost: poi.biz_ext?.cost,
      });
    });
    
    // Add markers
    addPOIMarkers(pois);
  }
});

// Search around a point
placeSearch.searchNearBy('餐厅', [lng, lat], 1000, (status, result) => {
  // 1000m radius
  if (status === 'complete') {
    const pois = result.poiList.pois;
    handleSearchResults(pois);
  }
});

// Search in bounds
const bounds = new AMap.Bounds([minLng, minLat], [maxLng, maxLat]);
placeSearch.searchInBounds('酒店', bounds, (status, result) => {
  if (status === 'complete') {
    const pois = result.poiList.pois;
    handleSearchResults(pois);
  }
});
```

### Autocomplete (Search Suggestions)

```typescript
// Import Autocomplete plugin
// ?v=2.0&key=...&plugin=AMap.Autocomplete

const autocomplete = new AMap.Autocomplete({
  city: '杭州',
  input: 'search-input',  // Input element id
});

// Listen for selection
autocomplete.on('select', (e) => {
  const poi = e.poi;
  
  if (poi.location) {
    map.setCenter(poi.location);
    map.setZoom(16);
    
    // Add marker
    const marker = new AMap.Marker({
      position: poi.location,
      title: poi.name,
    });
    map.add(marker);
  }
});

// Manual search
autocomplete.search('阿里巴巴', (status, result) => {
  if (status === 'complete') {
    const tips = result.tips;
    
    tips.forEach(tip => {
      console.log({
        name: tip.name,
        district: tip.district,
        address: tip.address,
        location: tip.location,
        type: tip.type,
      });
    });
    
    showSuggestions(tips);
  }
});
```

## Geocoding

### Forward Geocoding (Address → Coordinates)

```typescript
// Import Geocoder plugin
// ?v=2.0&key=...&plugin=AMap.Geocoder

const geocoder = new AMap.Geocoder({
  city: '杭州',
  radius: 1000,  // Search radius (m)
});

geocoder.getLocation('西湖区文一西路969号', (status, result) => {
  if (status === 'complete' && result.info === 'OK') {
    const geocode = result.geocodes[0];
    
    console.log({
      formattedAddress: geocode.formattedAddress,
      location: geocode.location,  // { lng, lat }
      level: geocode.level,        // Accuracy level
    });
    
    map.setCenter(geocode.location);
  }
});
```

### Reverse Geocoding (Coordinates → Address)

```typescript
geocoder.getAddress([lng, lat], (status, result) => {
  if (status === 'complete' && result.info === 'OK') {
    const regeocode = result.regeocode;
    
    console.log({
      formattedAddress: regeocode.formattedAddress,
      addressComponent: {
        province: regeocode.addressComponent.province,
        city: regeocode.addressComponent.city,
        district: regeocode.addressComponent.district,
        street: regeocode.addressComponent.street,
        streetNumber: regeocode.addressComponent.streetNumber,
      },
      pois: regeocode.pois,  // Nearby POIs
    });
    
    showAddressInfo(regeocode.formattedAddress);
  }
});
```

## Geolocation

### Get User Location

```typescript
// Browser Geolocation API (preferred for accuracy)
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { longitude, latitude, accuracy } = position.coords;
      
      // Center map
      map.setCenter([longitude, latitude]);
      map.setZoom(15);
      
      // Show accuracy circle
      const circle = new AMap.Circle({
        center: [longitude, latitude],
        radius: Math.max(accuracy, 30),
        fillColor: 'rgba(0, 122, 255, 0.1)',
        strokeColor: '#007AFF',
      });
      map.add(circle);
      
      // Add user marker
      const marker = new AMap.Marker({
        position: [longitude, latitude],
        icon: USER_LOCATION_ICON,
      });
      map.add(marker);
    },
    (error) => {
      console.warn('Geolocation failed:', error.message);
      // Fallback to default center
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    }
  );
}

// AMap Geolocation plugin (IP-based, less accurate)
// ?v=2.0&key=...&plugin=AMap.Geolocation

const geolocation = new AMap.Geolocation({
  enableHighAccuracy: true,
  timeout: 10000,
});

geolocation.getCurrentPosition((status, result) => {
  if (status === 'complete') {
    const { position, accuracy } = result;
    map.setCenter(position);
  } else {
    console.warn('Geolocation failed:', result.message);
  }
});
```

## Map Events

### Common Events

```typescript
// Map move
map.on('movestart', () => {
  console.log('Map started moving');
});

map.on('moveend', () => {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  
  // Trigger POI reload if needed
  if (shouldRefetchPOIs(bounds)) {
    fetchPOIs(bounds);
  }
});

// Zoom change
map.on('zoomstart', () => {
  console.log('Zoom started');
});

map.on('zoomend', () => {
  const zoom = map.getZoom();
  
  // Adjust marker size based on zoom
  if (zoom >= 15) {
    showDetailedMarkers();
  } else {
    showSimpleMarkers();
  }
});

// Click on map
map.on('click', (e) => {
  const lnglat = e.lnglat;
  console.log('Clicked at:', lnglat.lng, lnglat.lat);
  
  // Close info windows
  closeAllInfoWindows();
});

// Right-click (context menu)
map.on('rightclick', (e) => {
  const lnglat = e.lnglat;
  showContextMenu(e.pixel.x, e.pixel.y, lnglat);
});

// Double-click (zoom in)
map.on('dblclick', (e) => {
  // Prevent default zoom
  e.preventDefault();
  
  // Custom double-click behavior
  const lnglat = e.lnglat;
  map.setZoomAndCenter(map.getZoom() + 1, lnglat);
});

// Drag
map.on('dragstart', () => {
  console.log('Drag started');
});

map.on('dragging', () => {
  console.log('Dragging...');
});

map.on('dragend', () => {
  console.log('Drag ended');
  saveMapState();
});
```

## Map Controls

### Custom Controls

```typescript
// Create custom control
class LocateControl {
  constructor() {
    this.button = document.createElement('button');
    this.button.innerHTML = '📍';
    this.button.className = 'amap-custom-control';
    this.button.onclick = () => this.locate();
  }

  addTo(map) {
    this.map = map;
    map.addControl(this);
  }

  locate() {
    navigator.geolocation.getCurrentPosition((position) => {
      const { longitude, latitude } = position.coords;
      this.map.setZoomAndCenter(15, [longitude, latitude]);
    });
  }

  show() {
    this.button.style.display = 'block';
  }

  hide() {
    this.button.style.display = 'none';
  }
}

// Add control
const locateControl = new LocateControl();
map.addControl(locateControl);

// Position control
const controlBar = map.plugin(['AMap.ControlBar'], () => {
  const controlBar = new AMap.ControlBar({
    position: {
      top: '10px',
      right: '10px',
    },
  });
  map.addControl(controlBar);
});
```

### Scale Control

```typescript
// Position scale based on viewport
const updateScalePosition = () => {
  const isMobile = window.innerWidth <= 767;
  
  const scale = new AMap.Scale({
    position: isMobile ? 'LT' : 'LB',  // LT/RT/LB/RB
    offset: isMobile ? [12, 22] : [90, 25],
  });
  
  map.addControl(scale);
};

updateScalePosition();

window.addEventListener('resize', updateScalePosition);
```

## Performance Optimization

### Lazy Load Plugins

```typescript
// Load plugins on demand
async function loadAMapPlugin(pluginName: string) {
  return new Promise((resolve, reject) => {
    if (window.AMap && window.AMap[pluginName]) {
      resolve(window.AMap[pluginName]);
      return;
    }

    window.AMap.plugin(`AMap.${pluginName}`, () => {
      resolve(window.AMap[pluginName]);
    });
  });
}

// Usage
const PlaceSearch = await loadAMapPlugin('PlaceSearch');
const placeSearch = new PlaceSearch({ /* ... */ });
```

### Marker Optimization

```typescript
// Use mass markers for better performance (>100 markers)
const massMarkers = new AMap.MassMarks(data, {
  zIndex: 111,
  cursor: 'pointer',
  style: {
    url: '/marker-icon.png',
    size: [20, 30],
    anchor: [10, 30],
  },
});

massMarkers.on('click', (e) => {
  const { data } = e;
  handleMarkerClick(data.id);
});

massMarkers.setMap(map);

// Update data efficiently
massMarkers.setData(newData);
```

### Debounce Map Events

```typescript
import { debounce } from 'lodash';

// Debounce expensive operations
const debouncedFetchPOIs = debounce((bounds) => {
  fetchPOIs(bounds);
}, 300);

map.on('moveend', () => {
  const bounds = map.getBounds();
  debouncedFetchPOIs(bounds);
});
```

## Error Handling

### Handle API Errors

```typescript
function initMap() {
  if (!window.AMap) {
    showError('地图加载失败，请刷新页面重试');
    return;
  }

  try {
    mapInstance.current = new AMap.Map('map-container', {
      // ... config
    });
  } catch (error) {
    console.error('Map initialization failed:', error);
    showError('地图初始化失败');
  }
}

// Handle search errors
placeSearch.search('keyword', (status, result) => {
  if (status === 'error') {
    showToast('搜索失败，请重试');
    return;
  }

  if (status === 'no_data') {
    showEmptyState('未找到相关结果');
    return;
  }

  if (status === 'complete' && result.info === 'OK') {
    handleSearchResults(result.poiList.pois);
  }
});
```

### Rate Limiting

```typescript
// Track API calls
let apiCallCount = 0;
const API_CALL_LIMIT = 100;

function canMakeAPICall(): boolean {
  if (apiCallCount >= API_CALL_LIMIT) {
    showToast('请求过于频繁，请稍后再试');
    return false;
  }
  apiCallCount++;
  return true;
}

// Reset counter periodically
setInterval(() => {
  apiCallCount = 0;
}, 60000);  // Reset every minute
```

## TypeScript Definitions

### Declare AMap Types

```typescript
// types/amap.d.ts
declare global {
  interface Window {
    AMap?: typeof AMap;
    _AMapSecurityConfig?: {
      securityJsCode: string;
    };
  }
}

declare namespace AMap {
  class Map {
    constructor(container: string | HTMLElement, options?: MapOptions);
    setCenter(center: [number, number]): void;
    getCenter(): LngLat;
    setZoom(zoom: number): void;
    getZoom(): number;
    setBounds(bounds: Bounds): void;
    getBounds(): Bounds;
    flyTo(options: FlyToOptions): void;
    setPitch(pitch: number): void;
    getPitch(): number;
    setRotation(rotation: number, smooth?: boolean, duration?: number): void;
    getRotation(): number;
    add(overlay: any): void;
    remove(overlay: any): void;
    clearMap(): void;
    destroy(): void;
    on(event: string, callback: Function): void;
    off(event: string, callback: Function): void;
  }

  interface MapOptions {
    center?: [number, number];
    zoom?: number;
    viewMode?: '2D' | '3D';
    pitch?: number;
    rotation?: number;
    zooms?: [number, number];
    mapStyle?: string;
    features?: string[];
    showLabel?: boolean;
  }

  interface LngLat {
    lng: number;
    lat: number;
  }

  interface Bounds {
    southwest: LngLat;
    northeast: LngLat;
  }

  interface FlyToOptions {
    center: [number, number];
    zoom?: number;
    pitch?: number;
    rotation?: number;
    duration?: number;
  }

  class Marker {
    constructor(options: MarkerOptions);
    setPosition(position: [number, number]): void;
    getPosition(): LngLat;
    setIcon(icon: string | Icon): void;
    setExtData(data: any): void;
    getExtData(): any;
    on(event: string, callback: Function): void;
  }

  interface MarkerOptions {
    position: [number, number];
    icon?: string | Icon;
    title?: string;
    offset?: Pixel;
    zIndex?: number;
    clickable?: boolean;
    draggable?: boolean;
    extData?: any;
  }

  // Add more types as needed
}

export {};
```

## Common Issues

### Issue 1: Map Not Displaying

**Symptoms:** Blank container, no map tiles

**Causes:**
- Missing API key
- Wrong security code
- Container has no height
- Script not loaded

**Solutions:**
```typescript
// Check credentials
console.log('API Key:', process.env.NEXT_PUBLIC_AMAP_KEY ? 'Set' : 'Missing');

// Ensure container has height
<div id="map-container" style={{ width: '100%', height: '100vh' }} />

// Wait for script load
script.onload = () => {
  console.log('AMap loaded');
  initMap();
};
```

### Issue 2: Security Code Error

**Error:** `INVALID_USER_SCODE`

**Solution:**
```typescript
// Set security code BEFORE loading script
window._AMapSecurityConfig = {
  securityJsCode: process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE,
};

// Then load script
const script = document.createElement('script');
script.src = `https://webapi.amap.com/maps?v=2.0&key=${apiKey}`;
```

### Issue 3: Quota Exceeded

**Error:** `DAILY_QUERY_OVER_LIMIT`

**Solutions:**
- Cache POI data locally
- Reduce API calls (debounce, throttle)
- Apply for higher quota
- Use mass markers instead of individual requests

## Best Practices

1. **Cache POI Data**
   - Store frequently accessed POI in database
   - Use localStorage for recent searches
   - Set appropriate TTL (7 days for static data)

2. **Optimize API Calls**
   - Batch requests when possible
   - Debounce map move events
   - Only fetch POI in visible bounds

3. **Handle Errors Gracefully**
   - Show user-friendly error messages
   - Provide fallback options
   - Log errors for monitoring

4. **Clean Up Resources**
   ```typescript
   useEffect(() => {
     // Init map
     const map = initMap();
     
     return () => {
       // Cleanup
       map.destroy();
     };
   }, []);
   ```

5. **Monitor Usage**
   - Track API calls in development
   - Set up alerts for quota limits
   - Review console dashboard regularly

## Resources

- **Official Docs:** https://lbs.amap.com/api/javascript-api-v2/documentation
- **Examples:** https://lbs.amap.com/demo/javascript-api-v2/
- **Console:** https://console.amap.com/
- **Support:** https://lbs.amap.com/support/qa
- **Existing Implementation:** `src/components/map-shell.tsx`

## Questions?

Check existing implementation first, then refer to official examples or documentation.
