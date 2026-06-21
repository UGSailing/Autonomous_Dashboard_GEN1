import { useEffect, useState } from 'react'
import mqtt from 'mqtt'
import Map from './Map'
import Camera from './Camera'
import Topics from './Topics'
import SpeedCard from './SpeedCard'
import RPMCard from './RPMCard'
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

const ECU_HEARTBEAT_CAN_ID = 0x11
const SET_ANGLE_CAN_ID = 0x204

const topicsToDisplay = ['sense-3C6D66019257/gnss/Left/pvt', 'can/ugent/tx']

function App() {
  const [messages, setMessages] = useState<MqttMessage[]>([])
  const [gnssFix, setGnssFix] = useState<GnssFix | null>(null)
  const [rpm, setRpm] = useState<number | null>(null)
  const [angle, setAngle] = useState<number | null>(null)
  const [temperature, setTemperature] = useState<number | null>(null)
  const [humidity, setHumidity] = useState<number | null>(null)
  const forwardSpeed = calculateForwardSpeed(gnssFix?.Velocity?.North, gnssFix?.Velocity?.East)

  useEffect(() => {
    const client = mqtt.connect('ws://localhost:9001')

    client.on('connect', () => {
      console.log('[MQTT] connected')
      client.subscribe('#') // subscribe to all topics
    })

    client.on('message', (topic, message) => {
      const payload = message.toString()

      if (topic === 'sense-3C6D66019257/gnss/Left/pvt') {
        try {
          setGnssFix(JSON.parse(payload) as GnssFix)
        } catch {
          // Keep the previous valid fix if the payload is not JSON.
        }
      }

      if (topic === 'can/ugent/tx') {
        try {
          const message = JSON.parse(payload) as CanTxMessage
          const heartbeat = parseEcuHeartbeatFrame(message)
          const angleFrame = parseAngleFrame(message)

          if (heartbeat.temperature !== null) {
            setTemperature(heartbeat.temperature)
          }

          if (heartbeat.humidity !== null) {
            setHumidity(heartbeat.humidity)
          }

          if (angleFrame.angle !== null) {
            setAngle(angleFrame.angle)
          }

          if (heartbeat.rpm !== null) {
            setRpm(heartbeat.rpm)
          }
        } catch {
          // Keep the previous valid heartbeat values if the payload is malformed.
        }
      }

      setMessages((s) =>
        [
          {
            topic,
            payload,
          },
          ...s,
        ].slice(0, 100)
      )
    })

    client.on('error', (err) => {
      console.error('[MQTT] error', err)
    })

    return () => {
      client.end()
    }
  }, [])

  return (
    <div className="App">
      <header>
        <h1>MQTT Dashboard</h1>
        <p className="subhead">Live GNSS position for the boat and a running MQTT message log.</p>
      </header>

      <main className="dashboard-grid">
        <section className="panel panel-map">
          <div className="panel-heading">
            <h2>Map</h2>
            <p>Topic: sense-3C6D66019257/gnss/Left/pvt</p>
          </div>
          <Map fix={gnssFix} />
          <div className="fix-summary">
            {gnssFix?.FixIsValid ? (
              <>
                <strong>Fix valid</strong>
                <span>
                  {formatCoordinate(gnssFix?.Position?.LatLon?.Latitude)} , {formatCoordinate(gnssFix?.Position?.LatLon?.Longitude)}
                </span>
                <span>
                  {gnssFix?.SatsInUse ?? 0} in use, {gnssFix?.SatsInView ?? 0} in view
                </span>
              </>
            ) : (
              <span>Waiting for a valid GNSS fix.</span>
            )}
          </div>
        </section>

        <div className="dashboard-sidebar">
          <Camera />
        </div>


        <section className="panel panel-speed">
          <div className="panel-heading">
            <h2>RPM</h2>
            <p>
              {angle === null ? 'Set angle: N/A' : `Set angle: ${angle.toFixed(0)}°`}
              {' · '}
              {temperature === null ? 'Temp: N/A' : `Temp: ${temperature.toFixed(0)}°C`}
              {' · '}
              {humidity === null ? 'Humidity: N/A' : `Humidity: ${humidity.toFixed(0)}%`}
            </p>
          </div>
          <RPMCard rpm={rpm} />
        </section>

        <section className="panel panel-speed">
          <div className="panel-heading">
            <h2>Speed</h2>
            <p>Derived from north/east velocity</p>
          </div>
          <SpeedCard speedMetersPerSecond={forwardSpeed} />
        </section>
        <Topics messages={messages} displayTopics={topicsToDisplay} />


      </main>
    </div>
  )
}

function formatCoordinate(value?: number) {
  if (typeof value !== 'number') return 'N/A'
  return value.toFixed(6)
}

function calculateForwardSpeed(north?: number, east?: number) {
  if (typeof north !== 'number' || typeof east !== 'number') return null
  return Math.hypot(north, east)
}

function parseEcuHeartbeatFrame(message: CanTxMessage): EcuHeartbeatFrame {
  if (message.can_id !== ECU_HEARTBEAT_CAN_ID) {
    return { temperature: null, humidity: null, rpm: null }
  }

  if (typeof message.data !== 'string') {
    return { temperature: null, humidity: null, rpm: null }
  }

  const bytes = decodeBase64(message.data)
  if (bytes.length < 6) {
    return { temperature: null, humidity: null, rpm: null }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const temperature = view.getUint8(1) - 50
  const humidity = view.getUint8(2)
  const rpm = view.getInt16(3, true)

  return {
    temperature,
    humidity,
    rpm,
  }
}

function parseAngleFrame(message: CanTxMessage): AngleFrame {
  if (message.can_id !== SET_ANGLE_CAN_ID) {
    return { angle: null }
  }

  if (typeof message.data !== 'string') {
    return { angle: null }
  }

  const bytes = decodeBase64(message.data)
  if (bytes.length < 4) {
    return { angle: null }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const rawAngle = view.getInt16(2, true)
  const angle = (rawAngle / 1000) * 45

  return {
    angle,
  }
}

function decodeBase64(value: string) {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return bytes
  } catch {
    return new Uint8Array(0)
  }
}

export default App
