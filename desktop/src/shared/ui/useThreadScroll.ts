import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * One scroll rule for every thread (chat and transcript): follow new
 * content while the bottom edge is on screen; show a "Jump to latest"
 * control as soon as the user scrolls up to read. Never yanks the view
 * while someone is reading an older message.
 *
 * The follow decision reads the list's live scroll position instead of a
 * cached flag, so a wheel scroll that lands in the same moment as a new
 * message still wins — the user is never fought over the position.
 *
 * The list element's ref is created by the caller and passed in — a custom
 * hook must not hand refs (or callbacks that own them) back into render.
 */

/** Distance from the bottom that still counts as "following the thread". */
const BOTTOM_TOLERANCE_PX = 40;

function isAtBottom(list: HTMLDivElement): boolean {
  return (
    list.scrollHeight - list.scrollTop - list.clientHeight < BOTTOM_TOLERANCE_PX
  );
}

export interface ThreadScroll {
  /** The user has scrolled up and new content is below — show the jump. */
  showJump: boolean;
  jumpToLatest: () => void;
  /** Call from onScroll so the follow-state stays honest. */
  onScroll: () => void;
}

export function useThreadScroll(
  listRef: RefObject<HTMLDivElement | null>,
  trigger: unknown[],
): ThreadScroll {
  // Where the user last left the thread, as of the most recent scroll
  // event. Comparing the recorded position against the live one lets a
  // wheel scroll that hasn't fired its event yet still win over the
  // follow scroll — no cached "at bottom" flag can be fought.
  const atBottomRef = useRef(true);
  const knownScrollTopRef = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const onScroll = () => {
    const list = listRef.current;
    if (list === null) return;
    knownScrollTopRef.current = list.scrollTop;
    const atBottom = isAtBottom(list);
    atBottomRef.current = atBottom;
    setShowJump(!atBottom && list.scrollHeight > list.clientHeight);
  };

  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    // Following means "was at the bottom before this content arrived".
    // New content has already grown scrollHeight here, so the position
    // itself is the honest signal: untouched position + last-known-bottom
    // → follow; anything else → leave the user alone and offer the jump.
    const untouched = list.scrollTop === knownScrollTopRef.current;
    if (atBottomRef.current && untouched) {
      list.scrollTop = list.scrollHeight;
      return;
    }
    setShowJump(list.scrollHeight > list.clientHeight);
    // The dependency list is caller-owned (new messages, new lines, …), so
    // there is nothing for exhaustive-deps to verify here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, trigger);

  const jumpToLatest = () => {
    const list = listRef.current;
    if (list === null) return;
    list.scrollTop = list.scrollHeight;
    atBottomRef.current = true;
    knownScrollTopRef.current = list.scrollTop;
    setShowJump(false);
  };

  return { showJump, jumpToLatest, onScroll };
}
