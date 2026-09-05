// A small, reusable modal. It has no knowledge of "farmer" or "buyer" —
// it just displays whatever heading/body/closeLabel it's given, and calls
// onClose when the user is done. This keeps it reusable for the
// Voice Assistant preview too, instead of writing two separate modals.
export default function Modal({ heading, body, closeLabel, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        // Stop clicks inside the card from closing the modal via the backdrop
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{heading}</h3>
        <p>{body}</p>
        <button className="btn btn-primary" onClick={onClose} type="button">
          {closeLabel}
        </button>
      </div>
    </div>
  )
}
