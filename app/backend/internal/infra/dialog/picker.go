package dialog

// OSAPicker opens the native folder chooser of the current OS.
// A implementação de Pick é específica por sistema (arquivos por-OS).
type OSAPicker struct{}

// New builds an OSAPicker.
func New() *OSAPicker { return &OSAPicker{} }
