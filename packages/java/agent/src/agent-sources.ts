import {
  buildExoprocClass,
  buildNJavaAgentClass,
  type BuildExoprocOptions,
} from './agent-class-builder.js';

/**
 * Dynamically generates the agent Java source code strings with specific build options (version, buildId).
 */
export function getGeneratedAgentSources(
  options?: BuildExoprocOptions,
): Record<string, string> {
  return {
    'org/exoproc/njava/agent/utils/Exoproc.java':
      buildExoprocClass(options).toSource(),
    'org/exoproc/njava/agent/NJavaAgent.java':
      buildNJavaAgentClass().toSource(),
  };
}

/**
 * Embedded Java agent source code strings generated directly from fluent JavaClassBuilder definitions.
 */
export const EMBEDDED_AGENT_SOURCES: Record<string, string> =
  getGeneratedAgentSources();
