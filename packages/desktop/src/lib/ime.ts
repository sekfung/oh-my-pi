/**
 * True while an input method is composing (Chinese, Japanese, Korean, …).
 *
 * The candidate window owns Enter, Tab, Escape, and the arrow keys until the
 * composition commits, so any handler that binds those keys on a text field has
 * to stand down first — otherwise picking a candidate submits the prompt, and
 * paging through candidates recalls history instead. WebKit reports the
 * placeholder `keyCode` 229 for composition keydowns; `isComposing` covers the
 * engines that set it properly.
 */
export function isComposing(event: KeyboardEvent | { nativeEvent: KeyboardEvent }): boolean {
	const native = "nativeEvent" in event ? event.nativeEvent : event;
	return native.isComposing || native.keyCode === 229;
}
