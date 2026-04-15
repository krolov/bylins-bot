// Entry point for the browser bundle.
//
// During the incremental refactor of src/client.ts into modular files under
// src/client/, this file re-exports the legacy monolithic module so the build
// keeps working. Once all subsystems are extracted, this file becomes the
// real orchestrator.
import "../client.ts";
