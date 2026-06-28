import { useEffect, useRef, useState } from 'react'
import mqtt from 'mqtt'
import Map, { type Detection, type BuoyHistory, type Waypoint, type CrossLine } from './Map'
import Camera from './Camera'
import Topics from './Topics'
import SpeedCard from './SpeedCard'
import RPMCard from './RPMCard'
import RPMHistoryChart from './RPMHistoryChart'
import BatteryCard, { type BatteryData } from './Batterycard'
import AutonomousIndicator, { type EcuData } from './Autonomousindicator'
import './App.css'

export type MqttMessage = {
  topic: string
  payload: string
}

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
  Velocity?: {
    North?: number
    East?: number
    Down?: number
  }
  SatsInView?: number
  SatsInUse?: number
}

type CanTxMessage = {
  can_id?: number
  data?: string
}

type EcuHeartbeatFrame = {
  temperature: number | null
  humidity: number | null
  rpm: number | null
}

type AngleFrame = {
  angle: number | null
}

type RpmSample = {
  time: number
  rpm: number
}

const ECU_HEARTBEAT_CAN_ID = 0x11
const SET_ANGLE_CAN_ID = 0x204
const BMS_BATTERY_CAN_ID = 258
const ECU_INFO_CAN_ID = 0x121

const NMEA_HDT_TOPIC = 'sense-3C6D66019257/nmea/Left'
const DETECTIONS_TOPIC = 'detections/coordinates'
const BUOY_POSITIONS_TOPIC = 'detections/buoy_positions'
const PATH_TOPIC = 'navigation/path'
const CURRENT_WAYPOINT_TOPIC = 'navigation/current'
const CROSSLINE_TOPIC = 'navigation/crossline'

const topicsToDisplay = ['sense-3C6D66019257/gnss/Left/pvt', 'can/ugent/tx']

const LEFT_VIDEO_TOPIC = 'detections/video/left'
const RIGHT_VIDEO_TOPIC = 'detections/video/right'

// Page is served over HTTPS via Traefik → must use wss.
// Falls back to the local broker during `vite dev`.
const MQTT_URL =
  typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? 'wss://mqtt.ugentsailing.be'
    : 'ws://localhost:9001'

// Parse $GPHDT,269.23,T*09  →  269.23  (returns null on failure)
function parseNmeaHdt(sentence: string): number | null {
  const starIdx = sentence.indexOf('*')
  if (starIdx === -1) return null
  const body = sentence.slice(1, starIdx)
  const checksumHex = sentence.slice(starIdx + 1).trim()
  let xor = 0
  for (let i = 0; i < body.length; i++) xor ^= body.charCodeAt(i)
  if (xor.toString(16).toUpperCase().padStart(2, '0') !== checksumHex.toUpperCase()) return null
  const parts = body.split(',')
  if (!parts[0].endsWith('HDT')) return null
  const heading = parseFloat(parts[1])
  return isFinite(heading) ? heading : null
}

function parseDetections(payload: string): Detection[] {
  try {
    const raw = JSON.parse(payload)
    const items: Array<{ buoy?: string; latitude?: number; longitude?: number }> =
      Array.isArray(raw) ? raw : [raw]
    const now = Date.now()
    const results: Detection[] = []
    for (const item of items) {
      if (typeof item.latitude === 'number' && typeof item.longitude === 'number') {
        results.push({
          latitude: item.latitude,
          longitude: item.longitude,
          label: item.buoy !== undefined ? `Buoy ${item.buoy}` : undefined,
          timestamp: now,
        })
      }
    }
    return results
  } catch {
    return []
  }
}

// Parse the buoy_positions topic.
// Python publishes: [ [[lat,lon],[lat,lon],...], [[lat,lon],...], ... ]
function parseBuoyPositions(payload: string): BuoyHistory[] {
  try {
    const raw = JSON.parse(payload)
    if (!Array.isArray(raw)) return []
    return raw
      .filter(Array.isArray)
      .map((history: unknown[]) =>
        history
          .filter((pt): pt is [number, number] =>
            Array.isArray(pt) && pt.length >= 2 &&
            typeof pt[0] === 'number' && typeof pt[1] === 'number'
          )
          .map(([lat, lon]) => [lat, lon] as [number, number])
      )
      .filter((h) => h.length > 0)
  } catch {
    return []
  }
}

// Parse the navigation/path topic.
// Python publishes: [{"latitude":…,"longitude":…,"speed":…}, …]
function parsePath(payload: string): Waypoint[] {
  try {
    const raw = JSON.parse(payload)
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (wp): wp is Waypoint =>
        typeof wp?.latitude === 'number' &&
        typeof wp?.longitude === 'number' &&
        typeof wp?.speed === 'number'
    )
  } catch {
    return []
  }
}

// Parse the navigation/current topic.
// Python publishes: {"latitude":…,"longitude":…,"speed":…}
function parseCurrentWaypoint(payload: string): Waypoint | null {
  try {
    const wp = JSON.parse(payload)
    if (
      typeof wp?.latitude === 'number' &&
      typeof wp?.longitude === 'number' &&
      typeof wp?.speed === 'number'
    ) {
      return wp as Waypoint
    }
    return null
  } catch {
    return null
  }
}

// Parse the navigation/crossline topic.
// Python publishes: [[lat1, lon1], [lat2, lon2]]
function parseCrossLine(payload: string): CrossLine | null {
  try {
    const raw = JSON.parse(payload)
    if (
      Array.isArray(raw) &&
      raw.length >= 2 &&
      Array.isArray(raw[0]) && raw[0].length >= 2 &&
      typeof raw[0][0] === 'number' && typeof raw[0][1] === 'number' &&
      Array.isArray(raw[1]) && raw[1].length >= 2 &&
      typeof raw[1][0] === 'number' && typeof raw[1][1] === 'number'
    ) {
      return [[raw[0][0], raw[0][1]], [raw[1][0], raw[1][1]]]
    }
    return null
  } catch {
    return null
  }
}

// ── BMS Battery parser (CAN ID 258 / 0x102) ───────────────────────────────────
function parseBmsBattery(message: CanTxMessage): Partial<BatteryData> {
  if (message.can_id !== BMS_BATTERY_CAN_ID) return {}
  if (typeof message.data !== 'string') return {}
  const bytes = decodeBase64(message.data)
  if (bytes.length < 8) return {}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const voltage = view.getUint16(0, true) * 0.1
  const amperage = view.getUint16(2, true) * 0.1 - 1000
  const stateOfCharge = view.getUint8(4)
  const temperature = view.getUint8(5) - 50
  const online = (view.getUint8(6) & 0x01) === 1
  const error = (view.getUint8(7) & 0x01) === 1
  return { voltage, amperage, stateOfCharge, temperature, online, error }
}

// ── ECU Info parser (CAN ID 0x121 / 289) ─────────────────────────────────────
function parseEcuInfo(message: CanTxMessage): Partial<EcuData> {
  if (message.can_id !== ECU_INFO_CAN_ID) return {}
  if (typeof message.data !== 'string') return {}
  const bytes = decodeBase64(message.data)
  if (bytes.length < 8) return {}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ecuState = view.getUint8(0)
  const servoReady = (view.getUint8(1) & 0x01) === 1
  const motorReady = (view.getUint8(2) & 0x01) === 1
  const servoTemp = view.getInt8(3)
  const servoCTRLTemp = view.getInt8(4)
  const motorTemp = view.getInt8(5)
  const motorCTRLTemp = view.getInt8(6)
  const autonomousActive = (view.getUint8(7) & 0x01) === 1
  return { ecuState, servoReady, motorReady, servoTemp, servoCTRLTemp, motorTemp, motorCTRLTemp, autonomousActive }
}

const DEFAULT_BATTERY: BatteryData = {
  voltage: null, amperage: null, stateOfCharge: null,
  temperature: null, online: null, error: null,
}

const DEFAULT_ECU: EcuData = {
  ecuState: null, servoReady: null, motorReady: null,
  autonomousActive: null, servoTemp: null, servoCTRLTemp: null,
  motorTemp: null, motorCTRLTemp: null,
}

function App() {
  const [messages, setMessages] = useState<MqttMessage[]>([])
  const [gnssFix, setGnssFix] = useState<GnssFix | null>(null)
  const [headingDeg, setHeadingDeg] = useState<number | null>(null)
  const [detections, setDetections] = useState<Detection[]>([])
  const [buoyHistories, setBuoyHistories] = useState<BuoyHistory[]>([])
  const [waypoints, setWaypoints] = useState<Waypoint[]>([])
  const [currentWaypoint, setCurrentWaypoint] = useState<Waypoint | null>(null)
  const [crossLine, setCrossLine] = useState<CrossLine | null>(null)
  const [rpm, setRpm] = useState<number | null>(null)
  const [angle, setAngle] = useState<number | null>(null)
  const [temperature, setTemperature] = useState<number | null>(null)
  const [humidity, setHumidity] = useState<number | null>(null)
  const [rpmHistory, setRpmHistory] = useState<RpmSample[]>([])
  const [leftFrameUrl, setLeftFrameUrl] = useState<string | null>(null)
  const [rightFrameUrl, setRightFrameUrl] = useState<string | null>(null)
  const [batteryData, setBatteryData] = useState<BatteryData>(DEFAULT_BATTERY)
  const [ecuData, setEcuData] = useState<EcuData>(DEFAULT_ECU)

  const forwardSpeed = calculateForwardSpeed(
    gnssFix?.Velocity?.North,
    gnssFix?.Velocity?.East,
  )

  // Track current object URLs so we can revoke them when replaced
  const currentObjectUrls = useRef<{ left: string | null; right: string | null }>({
    left: null,
    right: null,
  })

  // MQTT
  useEffect(() => {
    const client = mqtt.connect(MQTT_URL, { resubscribe: false })

    client.on('connect', () => {
      console.log('[MQTT] connected')
      client.subscribe('#')
    })

    client.on('message', (topic, message) => {
      // ── Binary video frames — render immediately, no buffering ────────────
      // Frames are converted to object URLs and displayed as soon as they
      // arrive. The previous URL is revoked immediately to free memory.
      // No RAF loop or pendingFrames ref — that introduced a per-tick delay
      // that caused the 5-second lag when frames arrived faster than 60 fps.
      if (topic === LEFT_VIDEO_TOPIC) {
        const url = URL.createObjectURL(new Blob([new Uint8Array(message)], { type: 'image/jpeg' }))
        const previous = currentObjectUrls.current.left
        currentObjectUrls.current.left = url
        setLeftFrameUrl(url)
        if (previous) URL.revokeObjectURL(previous)
        return
      }
      if (topic === RIGHT_VIDEO_TOPIC) {
        const url = URL.createObjectURL(new Blob([new Uint8Array(message)], { type: 'image/jpeg' }))
        const previous = currentObjectUrls.current.right
        currentObjectUrls.current.right = url
        setRightFrameUrl(url)
        if (previous) URL.revokeObjectURL(previous)
        return
      }

      const payload = message.toString()

      // ── GNSS fix ─────────────────────────────────────────────────────────
      if (topic === 'sense-3C6D66019257/gnss/Left/pvt') {
        try { setGnssFix(JSON.parse(payload) as GnssFix) } catch { /* keep previous */ }
      }

      // ── Heading ───────────────────────────────────────────────────────────
      if (topic === NMEA_HDT_TOPIC) {
        const hdtLine = payload.split('\n').find((l) => l.includes('HDT'))
        if (hdtLine) {
          const heading = parseNmeaHdt(hdtLine.trim())
          if (heading !== null) setHeadingDeg(heading)
        }
      }

      // ── Individual detection events (legacy / live feed) ─────────────────
      if (topic === DETECTIONS_TOPIC) {
        const newDetections = parseDetections(payload)
        if (newDetections.length > 0) setDetections(newDetections)
      }

      // ── Full buoy position histories ──────────────────────────────────────
      if (topic === BUOY_POSITIONS_TOPIC) {
        const histories = parseBuoyPositions(payload)
        if (histories.length > 0) setBuoyHistories(histories)
      }

      // ── Planned path ──────────────────────────────────────────────────────
      if (topic === PATH_TOPIC) {
        const parsed = parsePath(payload)
        setWaypoints(parsed)
      }

      // ── Current (active) waypoint ─────────────────────────────────────────
      if (topic === CURRENT_WAYPOINT_TOPIC) {
        setCurrentWaypoint(parseCurrentWaypoint(payload))
      }

      // ── Cross-line ────────────────────────────────────────────────────────
      if (topic === CROSSLINE_TOPIC) {
        setCrossLine(parseCrossLine(payload))
      }

      // ── CAN bus ───────────────────────────────────────────────────────────
      if (topic === 'can/ugent/tx') {
        try {
          const msg = JSON.parse(payload) as CanTxMessage
          const heartbeat = parseEcuHeartbeatFrame(msg)
          const angleFrame = parseAngleFrame(msg)
          const bms = parseBmsBattery(msg)
          const ecu = parseEcuInfo(msg)

          if (heartbeat.temperature !== null) setTemperature(heartbeat.temperature)
          if (heartbeat.humidity !== null) setHumidity(heartbeat.humidity)
          if (angleFrame.angle !== null) setAngle(angleFrame.angle)

          if (Object.keys(bms).length > 0) setBatteryData((prev) => ({ ...prev, ...bms }))
          if (Object.keys(ecu).length > 0) setEcuData((prev) => ({ ...prev, ...ecu }))

          if (heartbeat.rpm !== null) {
            setRpm(heartbeat.rpm)
            setRpmHistory((samples) =>
              [...samples, { time: Date.now(), rpm: heartbeat.rpm }].slice(-120)
            )
          }
        } catch { /* keep previous */ }
      }

      setMessages((s) => [{ topic, payload }, ...s].slice(0, 100))
    })

    client.on('error', (err) => console.error('[MQTT] error', err))

    return () => {
      client.end()
      if (currentObjectUrls.current.left) URL.revokeObjectURL(currentObjectUrls.current.left)
      if (currentObjectUrls.current.right) URL.revokeObjectURL(currentObjectUrls.current.right)
    }
  }, [])

  return (
    <div className="App">
      <header className="app-header">
        <img className="app-logo" src="/logo.png" alt="UGent Sailing" />
        <div className="app-header__text">
          <h1>EMMA Dashboard</h1>
          <p className="subhead">Live Autonomous Data from UGent Sailing</p>
        </div>
      </header>

      <main className="dashboard-grid">
        <div className="dashboard-main-column">
          <section className="panel panel-map">
            <div className="panel-heading">
              <h2>Map</h2>
              <p>Topic: sense-3C6D66019257/gnss/Left/pvt</p>
            </div>
            <Map
              fix={gnssFix}
              headingDeg={headingDeg}
              detections={detections}
              buoyHistories={buoyHistories}
              waypoints={waypoints}
              currentWaypoint={currentWaypoint}
              crossLine={crossLine}
            />
            <div className="fix-summary">
              {gnssFix?.FixIsValid ? (
                <>
                  <strong>Fix valid</strong>
                  <span>
                    {formatCoordinate(gnssFix?.Position?.LatLon?.Latitude)} ,{' '}
                    {formatCoordinate(gnssFix?.Position?.LatLon?.Longitude)}
                  </span>
                  <span>
                    {gnssFix?.SatsInUse ?? 0} in use, {gnssFix?.SatsInView ?? 0} in view
                  </span>
                  {headingDeg !== null && <span>HDG {headingDeg.toFixed(1)}°</span>}
                </>
              ) : (
                <span>Waiting for a valid GNSS fix.</span>
              )}
            </div>
          </section>

          <section className="panel panel-dials">
            <div className="panel-heading">
              <h2>Speed &amp; RPM</h2>
              <p>
                {angle === null ? 'Set angle: N/A' : `Set angle: ${angle.toFixed(0)}°`}
                {' · '}
                {temperature === null ? 'Temp: N/A' : `Temp: ${temperature.toFixed(0)}°C`}
                {' · '}
                {humidity === null ? 'Humidity: N/A' : `Humidity: ${humidity.toFixed(0)}%`}
              </p>
            </div>
            <div className="dials-row">
              <div className="dial-block">
                <span className="dial-block__label">Speed</span>
                <SpeedCard speedMetersPerSecond={forwardSpeed} />
                <span className="dial-block__hint">Derived from north/east velocity</span>
              </div>
              <div className="dial-block">
                <span className="dial-block__label">RPM</span>
                <RPMCard rpm={rpm} />
                <span className="dial-block__hint">ECU heartbeat</span>
              </div>
            </div>
          </section>

          <div className="dashboard-metrics-grid">
            <section className="panel panel-chart panel-span-full">
              <div className="panel-heading">
                <h2>RPM History</h2>
                <p>Logged from the latest heartbeat samples</p>
              </div>
              <RPMHistoryChart samples={rpmHistory} />
            </section>

            <section className="panel panel-metric">
              <div className="panel-heading">
                <h2>Battery</h2>
                <p>BMS — CAN ID 0x102</p>
              </div>
              <div className="panel-body">
                <BatteryCard data={batteryData} />
              </div>
            </section>

            <section className="panel panel-metric">
              <div className="panel-heading">
                <h2>Drive Mode</h2>
                <p>ECU Info — CAN ID 0x121</p>
              </div>
              <div className="panel-body">
                <AutonomousIndicator data={ecuData} />
              </div>
            </section>

            {/* <Topics messages={messages} displayTopics={topicsToDisplay} /> */}
          </div>
        </div>

        <div className="dashboard-sidebar">
          <Camera leftSrc={leftFrameUrl} rightSrc={rightFrameUrl} />
        </div>
      </main>
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────────

function formatCoordinate(value?: number) {
  if (typeof value !== 'number') return 'N/A'
  return value.toFixed(6)
}

function calculateForwardSpeed(north?: number, east?: number) {
  if (typeof north !== 'number' || typeof east !== 'number') return null
  return Math.hypot(north, east)
}

function parseEcuHeartbeatFrame(message: CanTxMessage): EcuHeartbeatFrame {
  if (message.can_id !== ECU_HEARTBEAT_CAN_ID)
    return { temperature: null, humidity: null, rpm: null }
  if (typeof message.data !== 'string')
    return { temperature: null, humidity: null, rpm: null }
  const bytes = decodeBase64(message.data)
  if (bytes.length < 6) return { temperature: null, humidity: null, rpm: null }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    temperature: view.getUint8(1) - 50,
    humidity: view.getUint8(2),
    rpm: view.getInt16(3, true),
  }
}

function parseAngleFrame(message: CanTxMessage): AngleFrame {
  if (message.can_id !== SET_ANGLE_CAN_ID) return { angle: null }
  if (typeof message.data !== 'string') return { angle: null }
  const bytes = decodeBase64(message.data)
  if (bytes.length < 4) return { angle: null }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { angle: (view.getInt16(2, true) / 1000) * 45 }
}

function decodeBase64(value: string) {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return new Uint8Array(0)
  }
}

export default App