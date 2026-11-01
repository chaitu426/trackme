// Entry for the <script src> bundle. index.ts reads the script tag's data-* attributes and
// starts the tracker as a side effect and sets window.growth / window.trackme; importing it for
// that alone keeps the module-export wrapper out of the standalone file.
import "./index.js";
