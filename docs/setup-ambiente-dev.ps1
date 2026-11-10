# Setup do ambiente de desenvolvimento do Comunic.SIP
# Execute no PowerShell como Administrador.

# Instalar Chocolatey (gerenciador de pacotes do Windows)
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Instalar Node.js LTS (traz o npm junto)
choco install nodejs-lts -y

# Instalar TypeScript globalmente
npm install -g typescript

# Ferramentas de apoio
choco install postman -y
choco install docker-desktop -y
choco install postgresql -y
choco install vscode -y

# Extensoes recomendadas do VS Code
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension ms-azuretools.vscode-docker
code --install-extension eamodio.gitlens

Write-Host "Ambiente de desenvolvimento configurado."
Write-Host "Proximos passos:"
Write-Host "1. Abrir o VS Code na pasta do projeto: code ."
Write-Host "2. Instalar as dependencias de cada subprojeto: npm install"
Write-Host "3. Criar um arquivo .env com as variaveis de ambiente necessarias"
