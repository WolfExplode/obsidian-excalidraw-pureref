# Board activity feedback

Lengthy host-plugin operations show a spinner and an operation label in the
lower-right corner of the target Board, including editable Popouts. The indicator
does not intercept input. Separate concurrent operations retain their own labels.

PureRef imports (commands and drops), PureRef and selected-media exports,
Normalize, Reset Scale, optimal arrangement, and observed media import
transactions use this feedback. File pickers and choice prompts complete before
host-owned import/export feedback begins. Media import feedback lasts through
conversion, automatic packing, and the final Board save; abandoned transactions
use the existing import observer's expiry and teardown paths to clear it.

Calculations yield through animation frames so feedback can paint before
synchronous work begins. This is a rendering yield, not a readiness delay.
Synchronous calculations still occupy the renderer; the label stays visible
even when the spinner cannot animate during that work. No estimated percentages
are shown. Feedback clears on completion, failure, view teardown for observed
imports, or host-plugin unload. Deferred operations check that their Board is
still mounted and unchanged before starting.

Gravity packing keeps its synchronous success/no-op shortcut behavior. Optimal
arrangement consumes its shortcut for an eligible selection before calculating
the deferred layout, including when that layout ultimately needs no movement.
