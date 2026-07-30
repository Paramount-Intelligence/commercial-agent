/** Shared agent atmosphere, adapted from the main website Hero treatment. */
export default function ChatVideoBackground() {
  return (
    <div className="chat-video-background" aria-hidden="true">
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        className="chat-background-video"
      >
        <source src="/videos/background-video.webm" type="video/webm" />
      </video>

      <div className="chat-background-wash" />
    </div>
  );
}
