import { useEffect, useState } from 'react'
import mqtt from 'mqtt'
import Map from './Map'
import Camera from './Camera'
import Topics from './Topics'
import SpeedCard from './SpeedCard'
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

const topicsToDisplay = ['sense-3C6D66019257/gnss/Left/pvt']

function App() {
  const [messages, setMessages] = useState<MqttMessage[]>([])
  const [gnssFix, setGnssFix] = useState<GnssFix | null>(null)
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

export default App
