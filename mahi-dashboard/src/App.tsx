import { useEffect, useState } from 'react'
import mqtt from 'mqtt'
import Map from './Map'
import './App.css'

type MqttMessage = {
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
  SatsInView?: number
  SatsInUse?: number
}

function App() {
  const [messages, setMessages] = useState<MqttMessage[]>([])
  const [gnssFix, setGnssFix] = useState<GnssFix | null>(null)

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

        <section className="panel">
          <div className="panel-heading">
            <h2>Topics</h2>
            <p>Showing the latest {messages.length} messages</p>
          </div>
          {messages.length === 0 && <div className="empty-state">No messages yet</div>}
          <ul className="message-list">
            {messages.map((m, i) => (
              <li key={i} className="message-card">
                <div className="message-topic">{m.topic}</div>
                <pre className="message-payload">{tryDecode(m.payload)}</pre>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}

function formatCoordinate(value?: number) {
  if (typeof value !== 'number') return 'N/A'
  return value.toFixed(6)
}

function tryDecode(payload: string) {
  // payload might be base64 for binary; try utf8 then base64->utf8
  try {
    // if looks like base64 (contains non-printable), show as base64 shortened
    const buf = atob(payload)
    // if decoded contains many nulls or non-printable, return base64
    if (/\p{C}/u.test(buf)) return payload
    return buf
  } catch (e) {
    return payload
  }
}

export default App
