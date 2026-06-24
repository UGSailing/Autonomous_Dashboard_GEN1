import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type GnssFix = {
    FixIsValid?: boolean
    ReceiverName?: string
    Position?: {
        LatLon?: {
            Latitude?: number
            Longitude?: number
            Height?: number
        }
        AccuracyHorizontal?: number
    }
}

export type Detection = {
    latitude: number
    longitude: number
    label?: string
    timestamp: number
}

// A buoy's full position history: index 0 is the a-priori seed, subsequent
// entries are camera detections appended over time.
export type BuoyHistory = [number, number][]   // [(lat, lon), ...]

// A planned waypoint with an associated target speed.
export type Waypoint = {
    latitude: number
    longitude: number
    speed: number
}

const defaultCenter: [number, number] = [51.0, 3.7]

// ---------------------------------------------------------------------------
// Icon factories
// ---------------------------------------------------------------------------

function makeBoatIcon(headingDeg: number) {
    return L.divIcon({
        className: '',
        html: `<div style="
            width: 0;
            height: 0;
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-bottom: 22px solid #0f766e;
            transform: rotate(${headingDeg}deg);
            transform-origin: 50% 65%;
            filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
        "></div>`,
        iconSize: [16, 22],
        iconAnchor: [8, 14],
    })
}

// Waypoint cross: ✕ glyph in purple.
function makeWaypointIcon() {
    return L.divIcon({
        className: '',
        html: `<div style="
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            font-weight: 900;
            line-height: 1;
            color: #7c3aed;
            text-shadow: 0 1px 3px rgba(0,0,0,0.45);
            user-select: none;
        ">✕</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
    })
}

// Current (active) waypoint: bold red pulsing circle with ✕.
function makeCurrentWaypointIcon() {
    return L.divIcon({
        className: '',
        html: `<div style="
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        ">
            <div style="
                position: absolute;
                inset: 0;
                border-radius: 50%;
                background: rgba(220, 38, 38, 0.18);
                border: 2.5px solid #dc2626;
                animation: currentWaypointPulse 1.4s ease-in-out infinite;
            "></div>
            <div style="
                font-size: 18px;
                font-weight: 900;
                line-height: 1;
                color: #dc2626;
                text-shadow: 0 1px 4px rgba(0,0,0,0.5);
                user-select: none;
                position: relative;
                z-index: 1;
            ">✕</div>
        </div>
        <style>
            @keyframes currentWaypointPulse {
                0%, 100% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.35); opacity: 0.5; }
            }
        </style>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
    })
}

// A-priori buoy seed: filled amber circle with buoy index number.
function makeBuoySeedIcon(buoyIndex: number) {
    return L.divIcon({
        className: '',
        html: `<div style="
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: rgba(251, 191, 36, 0.9);
            border: 2px solid #d97706;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 700;
            color: #78350f;
            line-height: 1;
        ">${buoyIndex + 1}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
    })
}

// Camera-detected buoy position: small orange dot.
function makeDetectionDotIcon() {
    return L.divIcon({
        className: '',
        html: `<div style="
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #f97316;
            border: 1.5px solid #ea580c;
            opacity: 0.85;
        "></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
    })
}

// ---------------------------------------------------------------------------
// Internal bookkeeping type for a single buoy's map layers
// ---------------------------------------------------------------------------

type BuoyLayers = {
    seedMarker: L.Marker
    detectionMarkers: L.Marker[]
    trailLine: L.Polyline | null
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type MapProps = {
    fix: GnssFix | null
    headingDeg: number | null
    detections: Detection[]        // legacy single-position detections
    buoyHistories?: BuoyHistory[]  // per-buoy full position history
    waypoints?: Waypoint[]         // planned path waypoints with speed
    currentWaypoint?: Waypoint | null  // active waypoint, highlighted in red
}

export default function Map({
    fix,
    headingDeg,
    detections = [],
    buoyHistories = [],
    waypoints = [],
    currentWaypoint = null,
}: MapProps) {
    const mapElementRef = useRef<HTMLDivElement | null>(null)
    const mapRef = useRef<L.Map | null>(null)
    const markerRef = useRef<L.Marker | null>(null)
    const accuracyRef = useRef<L.CircleMarker | null>(null)
    const pathRef = useRef<L.Polyline | null>(null)
    const pathPointsRef = useRef<L.LatLngExpression[]>([])
    const hasCenteredRef = useRef(false)

    // Legacy single-position detection markers.
    const detectionLayersRef = useRef<globalThis.Map<string, L.Marker>>(
        new globalThis.Map()
    )

    // Per-buoy layers: seed marker + detection dots + trail polyline.
    const buoyLayersRef = useRef<BuoyLayers[]>([])

    // Waypoint markers + planned-path polyline.
    const waypointMarkersRef = useRef<L.Marker[]>([])
    const plannedPathRef = useRef<L.Polyline | null>(null)

    // Current waypoint marker.
    const currentWaypointMarkerRef = useRef<L.Marker | null>(null)

    const latitude = fix?.Position?.LatLon?.Latitude
    const longitude = fix?.Position?.LatLon?.Longitude
    const hasPosition =
        typeof latitude === 'number' && typeof longitude === 'number'
    const center: [number, number] = hasPosition
        ? [latitude, longitude]
        : defaultCenter

    // ---------------------------------------------------------------------------
    // Initialise the map once
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (!mapElementRef.current || mapRef.current) return

        const map = L.map(mapElementRef.current, {
            center: defaultCenter,
            zoom: 16,
            minZoom: 3,
            maxZoom: 22,
            scrollWheelZoom: true,
            zoomControl: true,
        })

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxNativeZoom: 19,
            maxZoom: 22,
        }).addTo(map)

        mapRef.current = map

        return () => {
            map.remove()
            mapRef.current = null
            markerRef.current = null
            accuracyRef.current = null
            pathRef.current = null
            pathPointsRef.current = []
            hasCenteredRef.current = false
            detectionLayersRef.current.clear()
            buoyLayersRef.current = []
            waypointMarkersRef.current = []
            plannedPathRef.current = null
            currentWaypointMarkerRef.current = null
        }
    }, [])

    // ---------------------------------------------------------------------------
    // Boat: position, heading arrow, accuracy ring, travelled-path trail
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const map = mapRef.current
        if (!map) return

        if (hasPosition) {
            const nextPoint: [number, number] = [latitude, longitude]
            const lastPoint = pathPointsRef.current[pathPointsRef.current.length - 1]
            const lastLat = Array.isArray(lastPoint) ? lastPoint[0] : undefined
            const lastLon = Array.isArray(lastPoint) ? lastPoint[1] : undefined

            if (lastLat !== latitude || lastLon !== longitude) {
                pathPointsRef.current = [...pathPointsRef.current, nextPoint]

                if (!pathRef.current) {
                    pathRef.current = L.polyline(pathPointsRef.current, {
                        color: '#0f766e',
                        weight: 4,
                        opacity: 0.85,
                        lineCap: 'round',
                        lineJoin: 'round',
                    }).addTo(map)
                } else {
                    pathRef.current.setLatLngs(pathPointsRef.current)
                }
            }

            if (!hasCenteredRef.current) {
                map.setView(center, map.getZoom(), { animate: true })
                hasCenteredRef.current = true
            }

            const icon = makeBoatIcon(headingDeg ?? 0)

            if (!markerRef.current) {
                markerRef.current = L.marker(center, { icon }).addTo(map)
            } else {
                markerRef.current.setLatLng(center)
                markerRef.current.setIcon(icon)
            }

            const popupHtml = `
                <strong>${fix?.ReceiverName ?? 'Boat'}</strong><br />
                Lat ${latitude?.toFixed(6)}, Lon ${longitude?.toFixed(6)}<br />
                Height ${fix?.Position?.LatLon?.Height?.toFixed(2) ?? 'N/A'} m<br />
                Heading ${headingDeg !== null ? headingDeg.toFixed(1) + '°' : 'N/A'}
            `
            markerRef.current.bindPopup(popupHtml)

            if (typeof fix?.Position?.AccuracyHorizontal === 'number') {
                const radius = Math.max(10, fix.Position.AccuracyHorizontal * 5)
                if (!accuracyRef.current) {
                    accuracyRef.current = L.circleMarker(center, {
                        radius,
                        color: '#115e59',
                        fillColor: '#115e59',
                        fillOpacity: 0.12,
                        weight: 2,
                    }).addTo(map)
                } else {
                    accuracyRef.current.setLatLng(center)
                    accuracyRef.current.setRadius(radius)
                }
            } else if (accuracyRef.current) {
                accuracyRef.current.remove()
                accuracyRef.current = null
            }
        }
    }, [center, fix, hasPosition, latitude, longitude, headingDeg])

    // ---------------------------------------------------------------------------
    // Waypoints: dashed purple planned-path polyline + ✕ cross markers
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const map = mapRef.current
        if (!map) return

        for (const m of waypointMarkersRef.current) m.remove()
        waypointMarkersRef.current = []

        if (plannedPathRef.current) {
            plannedPathRef.current.remove()
            plannedPathRef.current = null
        }

        if (waypoints.length === 0) return

        const latlngs: [number, number][] = waypoints.map(
            (wp) => [wp.latitude, wp.longitude]
        )
        plannedPathRef.current = L.polyline(latlngs, {
            color: '#7c3aed',
            weight: 2,
            opacity: 0.7,
            dashArray: '6 5',
            lineCap: 'round',
            lineJoin: 'round',
        }).addTo(map)

        for (let i = 0; i < waypoints.length; i++) {
            const wp = waypoints[i]
            const marker = L.marker([wp.latitude, wp.longitude], {
                icon: makeWaypointIcon(),
                zIndexOffset: 200,
            })
                .bindTooltip(
                    `WP ${i + 1} &nbsp;|&nbsp; ${wp.latitude.toFixed(5)}, ${wp.longitude.toFixed(5)}<br />Speed: ${wp.speed} m/s`,
                    { direction: 'top', offset: [0, -6] }
                )
                .addTo(map)

            waypointMarkersRef.current.push(marker)
        }
    }, [waypoints])

    // ---------------------------------------------------------------------------
    // Current waypoint: red pulsing ✕ marker (highest z-index)
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const map = mapRef.current
        if (!map) return

        if (currentWaypointMarkerRef.current) {
            currentWaypointMarkerRef.current.remove()
            currentWaypointMarkerRef.current = null
        }

        if (!currentWaypoint) return

        currentWaypointMarkerRef.current = L.marker(
            [currentWaypoint.latitude, currentWaypoint.longitude],
            {
                icon: makeCurrentWaypointIcon(),
                zIndexOffset: 500,
            }
        )
            .bindTooltip(
                `<strong>Current target</strong><br />${currentWaypoint.latitude.toFixed(5)}, ${currentWaypoint.longitude.toFixed(5)}<br />Speed: ${currentWaypoint.speed} m/s`,
                { direction: 'top', offset: [0, -8] }
            )
            .addTo(map)
    }, [currentWaypoint])

    // ---------------------------------------------------------------------------
    // Buoy histories: seed marker (amber) + detection dots + trail polyline
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const map = mapRef.current
        if (!map) return

        while (buoyLayersRef.current.length > buoyHistories.length) {
            const removed = buoyLayersRef.current.pop()!
            removed.seedMarker.remove()
            removed.detectionMarkers.forEach((m) => m.remove())
            removed.trailLine?.remove()
        }

        for (let i = 0; i < buoyHistories.length; i++) {
            const history = buoyHistories[i]
            if (history.length === 0) continue

            const [seedLat, seedLon] = history[0]
            const detectionPositions = history.slice(1)

            if (i >= buoyLayersRef.current.length) {
                const seedMarker = L.marker([seedLat, seedLon], {
                    icon: makeBuoySeedIcon(i),
                    zIndexOffset: 100,
                })
                    .bindTooltip(`Buoy ${i + 1} (a-priori seed)`, {
                        direction: 'top',
                        offset: [0, -6],
                    })
                    .addTo(map)

                buoyLayersRef.current.push({
                    seedMarker,
                    detectionMarkers: [],
                    trailLine: null,
                })
            } else {
                buoyLayersRef.current[i].seedMarker.setLatLng([seedLat, seedLon])
            }

            const layers = buoyLayersRef.current[i]

            for (
                let d = layers.detectionMarkers.length;
                d < detectionPositions.length;
                d++
            ) {
                const [dLat, dLon] = detectionPositions[d]
                const dot = L.marker([dLat, dLon], {
                    icon: makeDetectionDotIcon(),
                    zIndexOffset: 50,
                })
                    .bindTooltip(
                        `Buoy ${i + 1} — detection ${d + 1}<br />${dLat.toFixed(6)}, ${dLon.toFixed(6)}`,
                        { direction: 'top', offset: [0, -4] }
                    )
                    .addTo(map)
                layers.detectionMarkers.push(dot)
            }

            if (detectionPositions.length > 0) {
                const trailPoints: [number, number][] = [
                    [seedLat, seedLon],
                    ...detectionPositions.map(
                        ([lat, lon]) => [lat, lon] as [number, number]
                    ),
                ]
                if (!layers.trailLine) {
                    layers.trailLine = L.polyline(trailPoints, {
                        color: '#f97316',
                        weight: 1.5,
                        opacity: 0.6,
                        dashArray: '3 4',
                    }).addTo(map)
                } else {
                    layers.trailLine.setLatLngs(trailPoints)
                }
            }
        }
    }, [buoyHistories])

    // ---------------------------------------------------------------------------
    // Legacy single-position detections (kept for backwards compatibility)
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const map = mapRef.current
        if (!map) return

        const activeKeys = new Set<string>()

        for (const det of detections) {
            const key = `${det.latitude.toFixed(6)},${det.longitude.toFixed(6)}`
            activeKeys.add(key)

            if (!detectionLayersRef.current.has(key)) {
                const marker = L.marker([det.latitude, det.longitude], {
                    icon: L.divIcon({
                        className: '',
                        html: `<div style="
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        background: rgba(249, 115, 22, 0.25);
                        border: 2px solid #f97316;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 11px;
                        font-weight: 700;
                        color: #f97316;
                        line-height: 1;
                    ">${det.label ?? ''}</div>`,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16],
                    }),
                }).addTo(map)

                detectionLayersRef.current.set(key, marker as unknown as L.CircleMarker)
            }
        }

        for (const [key, marker] of detectionLayersRef.current.entries()) {
            if (!activeKeys.has(key)) {
                marker.remove()
                detectionLayersRef.current.delete(key)
            }
        }
    }, [detections])

    return (
        <div className="map-shell">
            <div ref={mapElementRef} className="leaflet-map" />
            {!hasPosition && (
                <div className="map-placeholder">Waiting for GNSS coordinates...</div>
            )}
        </div>
    )
}