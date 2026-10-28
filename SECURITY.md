# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.6.x   | :white_check_mark: |
| < 0.6.0 | :x:                |

## Reporting a Vulnerability

We take the security of Exoproc and its users seriously. If you discover a security vulnerability or architectural flaw:

1. **Do NOT open a public GitHub issue.**
2. Report the vulnerability privately by emailing `aw0ldan@gmail.com`.
3. Include detailed steps to reproduce the issue, affected versions, and potential impact.
4. We will acknowledge receipt within 48 hours and work with you on a coordinated disclosure timeline.

## Security Architecture & Boundaries

Exoproc is a low-level instrumentation and analysis toolkit. It operates under the following security model:

- **User Privilege Context:** Exoproc executes entirely in user-space with the permissions of the current operating system user. It does not install kernel drivers or modify kernel protection levels.
- **Process Boundaries:** Exoproc instruments processes that the invoking user already has Win32 permissions to open (`PROCESS_VM_READ`, `PROCESS_VM_WRITE`, `PROCESS_VM_OPERATION`).
- **No Daemon / No Open Network Ports:** The Exoproc MCP server communicates exclusively over standard input/output (`stdio`). It does not open background TCP/HTTP listening sockets, preventing unauthorized remote access.
- **Not a Sandbox:** Like all developer analysis tools (compilers, debuggers, disassemblers), executing untrusted C machine code or arbitrary binaries delegates execution to the host environment. Always run analysis of untrusted binaries in an isolated virtual machine or container.
