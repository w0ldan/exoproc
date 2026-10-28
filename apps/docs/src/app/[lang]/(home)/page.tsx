import Link from 'next/link';
import { i18n } from '@/lib/i18n';
import { InstallBox } from '@/components/home/InstallBox';
import {
  ArrowRight,
  Bot,
  Terminal,
  Zap,
  Binary,
  Code2,
  Eye,
  Coffee,
} from 'lucide-react';

const content = {
  tr: {
    title: 'Yapay Zeka Ajanları için Canlı Win32 Süreç Mühendisliği',
    subtitle:
      'Sıfır DLL enjeksiyonu. CreateRemoteThread yok. AI ajanları ve terminalinizi doğrudan Windows x64 thread context hijacking, MinHook detour ve canlı bellek manipülasyonuna bağlayın.',
    primaryAction: 'Dokümantasyon',
    secondaryAction: 'Web IDE',
    agentsLabel: 'Desteklenen AI Ajanları:',
    featuresTitle: 'Temel Mimari Özellikleri',
    featuresSubtitle:
      'Yüksek performanslı yerel sistem mühendisliği ve yapay zeka enstrümantasyonu',
    features: [
      {
        icon: Zap,
        title: 'NThread Context Hijacking',
        details:
          "SetThreadContext ile canlı bir thread'in RIP kaydını geçici olarak yönlendirir. CreateRemoteThread çağırmadan ve DLL enjekte etmeden hedef sürecin kendi döngüsünde uzaktan Win32 çağrıları yürütür.",
      },
      {
        icon: Binary,
        title: 'MinHook 5-Byte Detour & Relay',
        details:
          '5-byte rel32 JMP ile cerrahi fonksiyon kancası (hook). RIP-göreceli komutları otomatik yeniden konumlandıran tramplen ve ±2GB menzilini aşan hedefler için 14-byte far-detour relay ağ geçidi.',
      },
      {
        icon: Bot,
        title: '22 Stdio MCP Aracı',
        details:
          'AI kodlama ajanları için Model Context Protocol üzerinden 22 gelişmiş araç: Canlı bellek okuma/yazma, pattern tarama, MinHook yönetimi, Capstone disassembler ve ekran görüntüsü yakalama.',
      },
      {
        icon: Code2,
        title: 'TinyCC In-Memory JIT Derleme',
        details:
          'C kaynak kodunu mikrosaniyeler içinde doğrudan x86_64 makine koduna (shellcode) derler. kernel32, ntdll, user32 ve msvcrt hazır sembolleri önceden tanımlanmıştır.',
      },
      {
        icon: Coffee,
        title: 'JVM & Java Enstrümantasyonu',
        details:
          'Dinamik JNI yansıması (reflection), bytecode morfolojisi, agent RPC köprüsü ve obfuscated oyun/uygulama hedeflerinde Java 8 ile 21+ uyumluluğu.',
      },
      {
        icon: Eye,
        title: 'Pencere & Masaüstü Denetimi',
        details:
          'HWND pencere hiyerarşisini ve alt Win32 edit kontrollerini listeleyin, görsel doğrulama için tam ekran veya hedef pencere PNG ekran görüntüsü yakalayın.',
      },
    ],
    cliTitle: 'Tek Satırda Terminal Teşhisi',
    cliSubtitle: 'Zengin CLI araçları doğrudan geliştirici terminalinizde',
    commands: [
      {
        cmd: 'exoproc setup',
        desc: 'Tespit edilen tüm AI ajanlarını otomatik yapılandırır',
      },
      {
        cmd: 'exoproc mcp',
        desc: 'Stdio tabanlı Model Context Protocol sunucusunu başlatır',
      },
      {
        cmd: 'exoproc doctor',
        desc: 'Sistem sağlığını ve ajan konfigürasyonlarını denetler',
      },
      {
        cmd: 'exoproc ps',
        desc: 'Hedef sistemdeki aktif süreçleri listeleyip filtreler',
      },
      {
        cmd: 'exoproc windows',
        desc: 'Açık masaüstü pencerelerini ve HWND değerlerini döker',
      },
      {
        cmd: 'exoproc compile',
        desc: 'C kodunu doğrudan x64 shellcode makine koduna derler',
      },
    ],
    disclaimer:
      'Yalnızca yetkili güvenlik araştırması, tersine mühendislik, hata ayıklama ve eğitim amaçlıdır.',
  },
  en: {
    title: 'Live Win32 Process Internals for AI Coding Agents',
    subtitle:
      'Zero DLL injection. No CreateRemoteThread. Connect AI coding agents and your terminal directly to Windows x64 thread hijacking, MinHook detours, and live memory manipulation.',
    primaryAction: 'Documentation',
    secondaryAction: 'Web IDE',
    agentsLabel: 'Supported AI Agents:',
    featuresTitle: 'Core Systems Architecture',
    featuresSubtitle:
      'High-performance native reverse engineering and agentic process instrumentation',
    features: [
      {
        icon: Zap,
        title: 'NThread Context Hijacking',
        details:
          'Redirects a target thread RIP via SetThreadContext. Executes Win32 calls using existing thread cycles with zero injected DLLs and no CreateRemoteThread overhead.',
      },
      {
        icon: Binary,
        title: 'MinHook 5-Byte Detour & Relay',
        details:
          'Surgical 5-byte rel32 JMP detour with instruction relocations and an automatic 14-byte far-detour relay gateway for target addresses beyond ±2GB reach.',
      },
      {
        icon: Bot,
        title: '22 Stdio MCP Tools',
        details:
          'Standard Model Context Protocol tools for agents: live memory R/W, pattern scanning, MinHook installation, TinyCC JIT compilation, Capstone disasm, and desktop screenshots.',
      },
      {
        icon: Code2,
        title: 'TinyCC In-Memory JIT Compilation',
        details:
          'Compiles raw C source snippets into x86_64 shellcode in microseconds with pre-loaded Win32 headers (kernel32, ntdll, user32, msvcrt).',
      },
      {
        icon: Coffee,
        title: 'JVM & Java Instrumentation',
        details:
          'Dynamic JNI reflection, runtime bytecode morphing, agent RPC bridge, and shims for Java 8 through 21+ across obfuscated targets.',
      },
      {
        icon: Eye,
        title: 'Window & Desktop Inspection',
        details:
          'Enumerate HWND window hierarchies and Win32 child edit controls. Capture high-resolution desktop or window screenshots for visual verification.',
      },
    ],
    cliTitle: 'One-Line Terminal Diagnostics',
    cliSubtitle: 'Rich terminal commands ready out of the box',
    commands: [
      {
        cmd: 'exoproc setup',
        desc: 'Auto-detects and configures all installed AI agents',
      },
      {
        cmd: 'exoproc mcp',
        desc: 'Starts the stdio Model Context Protocol server',
      },
      {
        cmd: 'exoproc doctor',
        desc: 'Audits host environment and agent health status',
      },
      {
        cmd: 'exoproc ps',
        desc: 'Lists and inspects active processes on the host',
      },
      {
        cmd: 'exoproc windows',
        desc: 'Dumps desktop window hierarchy & HWNDs',
      },
      {
        cmd: 'exoproc compile',
        desc: 'Compiles C snippets directly to x64 shellcode',
      },
    ],
    disclaimer:
      'For authorized security research, reverse engineering, debugging, and education only.',
  },
} as const;

const AGENTS_LIST =
  'Claude Code · Cursor · Windsurf · Antigravity · Claude Desktop · Cline · OpenCode · Zed';

export default async function HomePage(props: PageProps<'/[lang]'>) {
  const { lang } = await props.params;
  const c =
    content[lang as keyof typeof content] ??
    content[i18n.defaultLanguage as keyof typeof content];

  const docsHref = lang === 'en' ? '/en/docs' : '/docs';
  const ideHref = lang === 'en' ? '/en/ide' : '/ide';

  return (
    <div className="flex flex-1 flex-col items-center px-4 pt-12 pb-20 sm:px-6">
      {/* Hero Header */}
      <div className="flex w-full max-w-4xl flex-col items-center text-center">
        {/* Title */}
        <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-white sm:text-5xl sm:leading-tight max-w-3xl">
          {c.title}
        </h1>

        {/* Subtitle */}
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400 sm:text-base max-w-2xl leading-relaxed">
          {c.subtitle}
        </p>

        {/* Single Universal Command Box */}
        <div className="mt-8 flex w-full justify-center">
          <InstallBox lang={lang} />
        </div>

        {/* Minimal Supported Agents Line */}
        <p className="mt-3 text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 font-mono tracking-tight">
          {c.agentsLabel} {AGENTS_LIST}
        </p>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={docsHref}
            className="flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 text-xs sm:text-sm font-semibold text-neutral-950 shadow-md transition-all hover:bg-cyan-400 active:scale-95"
          >
            <span>{c.primaryAction}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href={ideHref}
            className="rounded-lg border border-neutral-300/80 bg-white px-5 py-2.5 text-xs sm:text-sm font-semibold text-neutral-800 shadow-sm transition-all hover:bg-neutral-100 hover:text-neutral-950 dark:border-white/10 dark:bg-neutral-900/80 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"
          >
            {c.secondaryAction}
          </Link>
        </div>
      </div>

      {/* Core Architecture Features Grid */}
      <div className="mt-20 w-full max-w-5xl">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-3xl">
            {c.featuresTitle}
          </h2>
          <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400 sm:text-sm">
            {c.featuresSubtitle}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {c.features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="group relative rounded-xl border border-neutral-200/80 bg-white/70 p-5 shadow-sm transition-all hover:border-cyan-500/40 hover:bg-white hover:shadow-md dark:border-white/10 dark:bg-neutral-900/30 dark:shadow-none dark:hover:border-cyan-500/30 dark:hover:bg-neutral-900/60"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 text-cyan-600 transition-colors group-hover:border-cyan-500/40 group-hover:bg-cyan-50 dark:border-white/10 dark:bg-neutral-800 dark:text-cyan-400 dark:group-hover:border-cyan-500/30 dark:group-hover:bg-cyan-500/10">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold text-neutral-900 dark:text-neutral-100 text-base">
                  {feature.title}
                </h3>
                <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  {feature.details}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* CLI Quick Reference */}
      <div className="mt-20 w-full max-w-4xl">
        <div className="text-center mb-8">
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-2xl">
            {c.cliTitle}
          </h2>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400 sm:text-sm">
            {c.cliSubtitle}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {c.commands.map((item) => (
            <div
              key={item.cmd}
              className="flex items-start gap-3 rounded-lg border border-neutral-200/80 bg-white/70 p-3.5 shadow-sm dark:border-white/10 dark:bg-neutral-900/40 dark:shadow-none"
            >
              <Terminal className="h-4 w-4 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-mono text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                  {item.cmd}
                </span>
                <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Minimal Disclaimer Footer */}
      <div className="mt-20 w-full max-w-2xl text-center border-t border-neutral-200 dark:border-white/10 pt-8 pb-4">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {c.disclaimer}
        </p>
      </div>
    </div>
  );
}
