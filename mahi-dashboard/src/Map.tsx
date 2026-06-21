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

const defaultCenter: [number, number] = [51.0, 3.7]

const boatIcon = L.divIcon({
    className: 'boat-marker',
    html: '<div class="boat-marker-core"></div><div class="boat-marker-ring"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
})

type MapProps = {
    fix: GnssFix | null
}

export default function Map({ fix }: MapProps) {
    const mapElementRef = useRef<HTMLDivElement | null>(null)
    const mapRef = useRef<L.Map | null>(null)
    const markerRef = useRef<L.Marker | null>(null)
    const accuracyRef = useRef<L.CircleMarker | null>(null)
    const pathRef = useRef<L.Polyline | null>(null)
    const pathPointsRef = useRef<L.LatLngExpression[]>([])
    const hasCenteredRef = useRef(false)

    const latitude = fix?.Position?.LatLon?.Latitude
    const longitude = fix?.Position?.LatLon?.Longitude
    const hasPosition = typeof latitude === 'number' && typeof longitude === 'number'
    const center: [number, number] = hasPosition ? [latitude, longitude] : defaultCenter

    useEffect(() => {
        if (!mapElementRef.current || mapRef.current) return

        const map = L.map(mapElementRef.current, {
            center: defaultCenter,
            zoom: 16,
            scrollWheelZoom: true,
            zoomControl: true,
        })

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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
        }
    }, [])

    useEffect(() => {
        const map = mapRef.current
        if (!map) return

        if (hasPosition) {
            const nextPoint: [number, number] = [latitude, longitude]
            const lastPoint = pathPointsRef.current[pathPointsRef.current.length - 1]
            const lastLatitude = Array.isArray(lastPoint) ? lastPoint[0] : undefined
            const lastLongitude = Array.isArray(lastPoint) ? lastPoint[1] : undefined

            if (lastLatitude !== latitude || lastLongitude !== longitude) {
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

            if (!markerRef.current) {
                markerRef.current = L.marker(center, { icon: boatIcon }).addTo(map)
            } else {
                markerRef.current.setLatLng(center)
            }

            const popupHtml = `
        <strong>${fix?.ReceiverName ?? 'Boat'}</strong><br />
        Lat ${latitude?.toFixed(6)}, Lon ${longitude?.toFixed(6)}<br />
        Height ${fix?.Position?.LatLon?.Height?.toFixed(2) ?? 'N/A'} m
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
    }, [center, fix, hasPosition, latitude, longitude])

    return (
        <div className="map-shell">
            <div ref={mapElementRef} className="leaflet-map" />
            {!hasPosition && <div className="map-placeholder">Waiting for GNSS coordinates...</div>}
        </div>
    )
}