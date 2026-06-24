import './Autonomousindicator.css'

type EcuData = {
    ecuState: number | null
    servoReady: boolean | null
    motorReady: boolean | null
    autonomousActive: boolean | null
    servoTemp: number | null
    servoCTRLTemp: number | null
    motorTemp: number | null
    motorCTRLTemp: number | null
}

type Props = {
    data: EcuData
}

export type { EcuData }

const ECU_STATE_LABELS: Record<number, string> = {
    0: 'Idle',
    1: 'Starting',
    2: 'Running',
    3: 'Stopping',
    4: 'Fault',
}

function ecuStateLabel(state: number | null): string {
    if (state === null) return 'Unknown'
    return ECU_STATE_LABELS[state] ?? `State ${state}`
}

export default function AutonomousIndicator({ data }: Props) {
    const { ecuState, servoReady, motorReady, autonomousActive, servoTemp, servoCTRLTemp, motorTemp, motorCTRLTemp } = data
    const active = autonomousActive === true

    return (
        <div className={`auto-card ${active ? 'auto-card--active' : 'auto-card--manual'}`}>
            {/* Big mode banner */}
            <div className="auto-mode-banner">
                <div className={`auto-mode-dot ${active ? 'auto-mode-dot--active' : ''}`} />
                <span className="auto-mode-label">{active ? 'Autonomous' : 'Manual'}</span>
            </div>

            {/* ECU state + readiness */}
            <div className="auto-meta-row">
                <span className="auto-ecu-state">{ecuStateLabel(ecuState)}</span>
                <div className="auto-readiness">
                    <ReadinessChip label="Servo" ready={servoReady} />
                    <ReadinessChip label="Motor" ready={motorReady} />
                </div>
            </div>

            {/* Temperatures */}
            <div className="auto-temps">
                <TempCell label="Servo" value={servoTemp} />
                <TempCell label="Servo CTRL" value={servoCTRLTemp} />
                <TempCell label="Motor" value={motorTemp} />
                <TempCell label="Motor CTRL" value={motorCTRLTemp} />
            </div>
        </div>
    )
}

function ReadinessChip({ label, ready }: { label: string; ready: boolean | null }) {
    const cls =
        ready === null ? 'chip--unknown' : ready ? 'chip--ready' : 'chip--not-ready'
    return (
        <span className={`readiness-chip ${cls}`}>
            {ready === null ? '?' : ready ? '✓' : '✗'} {label}
        </span>
    )
}

function TempCell({ label, value }: { label: string; value: number | null }) {
    return (
        <div className="auto-temp-cell">
            <dt>{label}</dt>
            <dd>{value !== null ? `${value} °C` : '—'}</dd>
        </div>
    )
}