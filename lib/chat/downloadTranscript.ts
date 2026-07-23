/**
 * Trigger a session-gated transcript PDF download in the browser.
 */
export async function downloadConversationTranscript(
  conversationId: string,
): Promise<void> {
  const res = await fetch(
    `/api/chat/transcript?conversationId=${encodeURIComponent(conversationId)}`,
  );
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    let message = 'Could not download transcript';
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const header = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/i.exec(header);
  const filename =
    match?.[1] || `paramount-conversation-${conversationId.slice(0, 8)}.pdf`;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
