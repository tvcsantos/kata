import kataLogo from "./assets/kata-logo.png";

/**
 * Launch animation: the logo lands with a soft overshoot, holds a beat,
 * and the whole splash fades away (`splash-out` ends the show). A click
 * skips it.
 */
export function Splash(props: { onDone: () => void }): React.JSX.Element {
  return (
    <div
      className="splash"
      onClick={props.onDone}
      onAnimationEnd={(event) => {
        if (event.animationName === "splash-out") props.onDone();
      }}
    >
      <img className="splash-logo" src={kataLogo} alt="" />
      <span className="splash-name">kata</span>
    </div>
  );
}
