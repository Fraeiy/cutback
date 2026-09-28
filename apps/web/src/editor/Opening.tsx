import { useRef, useState } from "react"
import { Brand } from "./Brand"

const VIDEO_NAME = /\.(mp4|mov|webm|mkv|m4v)$/i

function videoFiles(list: FileList | File[]): File[] {
  return Array.from(list).filter((file) => file.type.startsWith("video/") || VIDEO_NAME.test(file.name))
}

export function Opening({
  busy,
  status,
  error,
  onFiles,
}: {
  busy: boolean
  status: string
  error: string | null
  onFiles: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)

  function take(list: FileList | File[]) {
    const files = videoFiles(list)
    if (files.length === 0) {
      setRejected("That file is not a video. Use MP4, MOV, WEBM, or MKV.")
      return
    }
    setRejected(null)
    onFiles(files)
  }

  return (
    <main className="opening">
      <header className="opening-bar">
        <Brand large />
      </header>
      <section className="opening-stage">
        <h1>Edit by talking.</h1>
        <p className="opening-lead">
          Add a video. Cutback writes the transcript, then you say what to cut, caption, or reframe.
        </p>
        <div
          className={`opening-drop ${over ? "is-over" : ""} ${busy ? "is-busy" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault()
            if (!busy) setOver(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = "copy"
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) return
            setOver(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setOver(false)
            if (!busy) take(event.dataTransfer.files)
          }}
          onClick={() => {
            if (!busy) input.current?.click()
          }}
          onKeyDown={(event) => {
            if (busy) return
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              input.current?.click()
            }
          }}
          role="button"
          tabIndex={0}
          aria-disabled={busy}
          aria-label={busy ? status : "Drop a video, or choose a file"}
        >
          {busy ? (
            <>
              <span className="opening-progress" aria-hidden="true"><i /></span>
              <b>{status}</b>
              <span>The editor opens as soon as the clip is in.</span>
            </>
          ) : (
            <>
              <span className="opening-glyph" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 16V5M7 9l5-5 5 5" />
                  <path d="M4 15v4h16v-4" />
                </svg>
              </span>
              <b>Drop a video here</b>
              <span>or choose one from this device</span>
            </>
          )}
        </div>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv,.m4v"
          multiple
          onChange={(event) => {
            const files = event.target.files
            if (files?.length) take(files)
            event.currentTarget.value = ""
          }}
        />
        {!busy && (
          <button className="primary opening-choose" type="button" onClick={() => input.current?.click()}>
            Choose a video
          </button>
        )}
        <p className="opening-meta">MP4, MOV, WEBM, or MKV. Up to 2 minutes and 200 MB a clip. Several files can go in together.</p>
        {(rejected || error) && <p className="opening-error" role="alert">{rejected || error}</p>}
        <ul className="opening-points">
          <li>
            <b>Transcript</b>
            <span>Every line stays locked to the picture.</span>
          </li>
          <li>
            <b>Voice</b>
            <span>Say what to change, then approve the edit.</span>
          </li>
          <li>
            <b>Export</b>
            <span>The preview and the MP4 are the same cut.</span>
          </li>
        </ul>
      </section>
    </main>
  )
}
