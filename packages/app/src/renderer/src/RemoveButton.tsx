/** The trash-bin icon button used wherever a list entry can be removed. */
export function RemoveButton(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      className="icon-button"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
        />
      </svg>
    </button>
  );
}
