import type { MqttMessage } from './App'

type TopicsProps = {
    messages: MqttMessage[]
    displayTopics: string[]
}

export default function Topics({ messages, displayTopics }: TopicsProps) {
    const filteredMessages = messages.filter((message) => displayTopics.includes(message.topic)).slice(0, 20)

    return (
        <section className="panel topics-panel">
            <div className="panel-heading">
                <h2>Topics</h2>
                <p>Showing the latest {filteredMessages.length} matching messages</p>
            </div>
            {filteredMessages.length === 0 && <div className="empty-state">No matching messages yet</div>}
            <ul className="message-list">
                {filteredMessages.map((message, index) => (
                    <li key={`${message.topic}-${index}`} className="message-card">
                        <div className="message-topic">{message.topic}</div>
                        <pre className="message-payload">{tryDecode(message.payload)}</pre>
                    </li>
                ))}
            </ul>
        </section>
    )
}

function tryDecode(payload: string) {
    try {
        const buf = atob(payload)
        if (/\p{C}/u.test(buf)) return payload
        return buf
    } catch {
        return payload
    }
}