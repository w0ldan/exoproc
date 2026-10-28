# Run in Command Prompt or PowerShell: powershell -c "irm https://exoproc.woldan.me/install.ps1|iex"

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Banner {
    Write-Host @"

  ==============================================================
   EXOPROC - Native Windows x64 Reverse Engineering Toolkit
  ==============================================================

"@ -ForegroundColor Cyan
    Write-Host "  Native Windows x64 Reverse Engineering & AI Agent Toolkit" -ForegroundColor White
    Write-Host "  Zero DLL Injection -- No CreateRemoteThread -- Real-Time Win32 Internals`n" -ForegroundColor DarkGray
}

function Test-CommandExists {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    return ($null -ne $cmd)
}

function Install-Bun {
    Write-Host "[*] Bun runtime not found. Installing official Bun for Windows..." -ForegroundColor Yellow
    try {
        Invoke-Expression (Invoke-RestMethod https://bun.sh/install.ps1)
        
        $bunDir = "$env:USERPROFILE\.bun\bin"
        if (Test-Path $bunDir) {
            $env:Path = "$bunDir;$env:Path"
        }
        
        if (-not (Test-CommandExists "bun")) {
            throw "Bun executable was not detected on PATH after installation."
        }
        
        $bunVer = bun --version
        Write-Host "[+] Bun successfully installed ($bunVer)`n" -ForegroundColor Green
    } catch {
        Write-Host "[-] Failed to automatically install Bun: $_" -ForegroundColor Red
        Write-Host "Please install Bun manually from https://bun.sh and re-run this script." -ForegroundColor Yellow
        exit 1
    }
}

function Ensure-BunPath {
    $bunBin = "$env:USERPROFILE\.bun\bin"
    if (Test-Path $bunBin) {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$bunBin*") {
            Write-Host "[*] Adding Bun directory to User PATH: $bunBin" -ForegroundColor DarkGray
            [Environment]::SetEnvironmentVariable("Path", "$bunBin;$userPath", "User")
            $env:Path = "$bunBin;$env:Path"
        }
    }
}

try {
    Write-Banner

    # 1. Ensure Bun is installed
    if (-not (Test-CommandExists "bun")) {
        Install-Bun
    } else {
        $bunVer = bun --version
        Write-Host "[+] Found Bun runtime ($bunVer)" -ForegroundColor Green
    }

    Ensure-BunPath

    # 2. Install Exoproc from npm
    Write-Host "`n[*] Installing Exoproc from npm..." -ForegroundColor Yellow
    
    $installed = $false
    try {
        bun add -g exoproc@latest
        if ($LASTEXITCODE -eq 0) {
            $installed = $true
        }
    } catch {}

    if (-not $installed) {
        if (Test-CommandExists "npm") {
            Write-Host "[*] Retrying installation with npm..." -ForegroundColor DarkGray
            npm install -g exoproc@latest
            if ($LASTEXITCODE -eq 0) {
                $installed = $true
            }
        }
    }

    if (-not $installed) {
        throw "Failed to install exoproc from npm registry."
    }

    Write-Host "[+] Exoproc CLI installed successfully from npm`n" -ForegroundColor Green

    # 3. Run interactive agent setup wizard
    Write-Host "[*] Starting automated AI agent configuration wizard...`n" -ForegroundColor Cyan
    bun x exoproc setup
} catch {
    Write-Host "`n[-] Installation failed: $_" -ForegroundColor Red
    exit 1
}
