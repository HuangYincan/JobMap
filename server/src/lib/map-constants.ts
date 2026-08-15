// Map Interaction Constants
// Extract these to eliminate magic numbers in map-shell.tsx

/**
 * Map Control Sensitivity
 * Fine-tuned for smooth, Apple Maps-like interaction
 */
export const MAP_CONTROLS = {
  // Middle-button 3D control sensitivity
  ROTATION_SENSITIVITY: 0.13,  // Degrees per pixel (X-axis drag)
  PITCH_SENSITIVITY: 0.15,     // Degrees per pixel (Y-axis drag)

  // Pitch constraints (AMap limitation)
  MIN_PITCH: 0,    // Flat view
  MAX_PITCH: 83,   // Maximum tilt angle

  // Animation durations (milliseconds)
  COMPASS_RESET_DURATION: 300,  // Smooth but quick, matches Apple Maps

  // Default map center (Hangzhou West Lake area)
  DEFAULT_CENTER: {
    lng: 120.15,
    lat: 30.27,
  },

  // Default zoom levels
  DEFAULT_ZOOM: 13,              // City overview
  USER_LOCATION_ZOOM: 15,        // Street-level detail

  // User location accuracy circle
  MIN_ACCURACY_RADIUS: 30,       // Minimum circle radius (meters)
  ACCURACY_CIRCLE_ZOOM_THRESHOLD: 15,  // Show circle when zoom >= this
} as const;

/**
 * Sidebar Layout Constants
 */
export const SIDEBAR = {
  COLLAPSED_WIDTH: 58,   // px, icon-only view
  EXPANDED_WIDTH: 276,   // px, full sidebar with text

  // Animation timing
  WIDTH_TRANSITION_MS: 350,
  TEXT_FADE_OUT_MS: 200,
  TEXT_FADE_IN_MS: 250,
  TEXT_FADE_IN_DELAY_MS: 100,

  // Cubic bezier for smooth ease-out (Apple style)
  TIMING_FUNCTION: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

/**
 * Mobile Drawer Constants
 */
export const MOBILE_DRAWER = {
  BREAKPOINT: 767,  // px, mobile viewport max width
} as const;

/**
 * User Location Marker Icons
 * Data URIs for inline SVG icons
 */
export const USER_LOCATION_ICONS = {
  // Detailed icon for high zoom (>=15)
  CIRCLE_WITH_PULSE:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Ccircle cx='10' cy='10' r='8' fill='%234A90E2' opacity='0.3'/%3E%3Ccircle cx='10' cy='10' r='4' fill='%234A90E2'/%3E%3Ccircle cx='10' cy='10' r='2' fill='white'/%3E%3C/svg%3E",

  // Simple dot for low zoom (<15)
  SIMPLE_DOT:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Ccircle cx='7' cy='7' r='6' fill='%234A90E2'/%3E%3Ccircle cx='7' cy='7' r='2' fill='white'/%3E%3C/svg%3E",

  // Icon sizes
  DETAILED_SIZE: 20,  // px
  SIMPLE_SIZE: 14,    // px
} as const;

/**
 * Compass Needle Constants
 */
export const COMPASS = {
  NEEDLE_SIZE: 26,     // px, width and height
  VIEWBOX_SIZE: 20,    // SVG viewBox coordinate space
} as const;

/**
 * Map Scale Control Positioning
 * Adaptive positioning based on viewport
 */
export const SCALE_CONTROL = {
  // Desktop (left-bottom, avoid sidebar)
  DESKTOP_POSITION: 'LB' as const,
  DESKTOP_OFFSET: [90, 25] as const,  // [x, y] in pixels

  // Mobile (left-top, avoid drawer)
  MOBILE_POSITION: 'LT' as const,
  MOBILE_OFFSET: [12, 22] as const,
} as const;

/**
 * Map Style Identifiers
 * AMap style URLs
 */
export const MAP_STYLES = {
  NORMAL: 'amap://styles/normal',
  SATELLITE: 'satellite',  // Uses TileLayer.Satellite, not mapStyle
  WHITESMOKE: 'amap://styles/whitesmoke',  // Dark mode
} as const;

/**
 * Type Exports
 * For use in components with proper typing
 */
export type MapStyle = keyof typeof MAP_STYLES;
export type DrawerState = 'mini' | 'half' | 'full';

// Usage example in component:
// import { MAP_CONTROLS } from '@/lib/map-constants';
// const rotationChange = deltaX * MAP_CONTROLS.ROTATION_SENSITIVITY;
