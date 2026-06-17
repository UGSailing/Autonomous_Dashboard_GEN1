import { useState } from 'react'

type StreamMode = 'left' | 'right' | 'both'

const streamConfigs = {
    left: {
        label: 'Left camera',
        src: 'http://localhost:9000/stream/left',
    },
    right: {
        label: 'Right camera',
        src: 'http://localhost:9000/stream/right',
    },
} as const

export default function Camera() {
    const [mode, setMode] = useState<StreamMode>('both')

    return (
        <section className="panel panel-camera">
            <div className="panel-heading">
                <h2>Camera</h2>
                <p>Live MJPEG feeds from the local stream server</p>
            </div>

            <div className="camera-controls" role="tablist" aria-label="Camera view mode">
                <button type="button" className={mode === 'left' ? 'camera-control is-active' : 'camera-control'} onClick={() => setMode('left')}>
                    Left
                </button>
                <button type="button" className={mode === 'right' ? 'camera-control is-active' : 'camera-control'} onClick={() => setMode('right')}>
                    Right
                </button>
                <button type="button" className={mode === 'both' ? 'camera-control is-active' : 'camera-control'} onClick={() => setMode('both')}>
                    Both
                </button>
            </div>

            <div className={mode === 'both' ? 'camera-grid' : 'camera-grid camera-grid--single'}>
                {mode !== 'right' && <StreamFrame src={streamConfigs.left.src} label={streamConfigs.left.label} />}
                {mode !== 'left' && <StreamFrame src={streamConfigs.right.src} label={streamConfigs.right.label} />}
            </div>
        </section>
    )
}

type StreamFrameProps = {
    src: string
    label: string
}

function StreamFrame({ src, label }: StreamFrameProps) {
    return (
        <figure className="camera-frame">
            <img className="camera-frame__image" src={src} alt={label} />
            <figcaption className="camera-frame__caption">{label}</figcaption>
        </figure>
    )
}