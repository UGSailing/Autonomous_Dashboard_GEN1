import { useState } from 'react'

type StreamMode = 'left' | 'right' | 'both'

type CameraProps = {
    leftSrc: string | null
    rightSrc: string | null
}

const streamLabels = {
    left: 'Left camera',
    right: 'Right camera',
} as const

export default function Camera({ leftSrc, rightSrc }: CameraProps) {
    const [mode, setMode] = useState<StreamMode>('both')

    return (
        <section className="panel panel-camera">
            <div className="panel-heading">
                <h2>Camera</h2>
                <p>Live detection feeds over MQTT</p>
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
                {mode !== 'right' && <StreamFrame src={leftSrc} label={streamLabels.left} />}
                {mode !== 'left' && <StreamFrame src={rightSrc} label={streamLabels.right} />}
            </div>
        </section>
    )
}

type StreamFrameProps = {
    src: string | null
    label: string
}

function StreamFrame({ src, label }: StreamFrameProps) {
    return (
        <figure className="camera-frame">
            {src ? (
                <img className="camera-frame__image" src={src} alt={label} />
            ) : (
                <div className="camera-frame__image camera-frame__placeholder">Waiting for stream…</div>
            )}
            <figcaption className="camera-frame__caption">{label}</figcaption>
        </figure>
    )
}