#!/usr/bin/env bash

# ==============================================================================
# plumar-cli Direct GitHub Installation Script
# ==============================================================================
# Installs plumar-cli straight from the GitHub repository into your user directory,
# installs dependencies, and deploys the binary globally on your system.
# ==============================================================================

# Color codes for premium aesthetics
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Banners and headers
print_banner() {
  echo -e "${CYAN}${BOLD}======================================================================${NC}"
  echo -e "${PURPLE}${BOLD}             ⚡ plumar-cli GITHUB INSTANT INSTALLER ⚡             ${NC}"
  echo -e "${CYAN}${BOLD}======================================================================${NC}"
  echo ""
}

print_success() {
  echo -e "${GREEN}${BOLD}✔ [SUCCESS] $1${NC}"
}

print_info() {
  echo -e "${BLUE}${BOLD}ℹ [INFO] $1${NC}"
}

print_warn() {
  echo -e "${YELLOW}${BOLD}⚠ [WARNING] $1${NC}"
}

print_error() {
  echo -e "${RED}${BOLD}✘ [ERROR] $1${NC}"
}

print_banner

# 1. Prerequisite Verification
print_info "Verifying system prerequisites..."

if ! command -v git >/dev/null 2>&1; then
  print_error "Git is not installed. Please install Git first to proceed."
  exit 1
fi
print_success "Git is available."

if ! command -v node >/dev/null 2>&1; then
  print_error "Node.js is not installed. Please install Node.js (v22+) first."
  exit 1
fi
NODE_VER=$(node -v)
# Extract major version number (e.g., 22 from v22.1.0)
NODE_MAJOR=$(echo "$NODE_VER" | tr -d 'v' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  print_error "plumar-cli requires Node.js v22 or higher. Current version is: $NODE_VER"
  exit 1
fi
print_success "Node.js is available: $NODE_VER (v22+ requirement met)"

if ! command -v npm >/dev/null 2>&1; then
  print_error "npm is not installed. Please install npm first."
  exit 1
fi
print_success "npm is available: $(npm -v)"

# Determine installation directory
INSTALL_DIR="$HOME/.plumar"
REPO_URL="https://github.com/nuno-joao-andrade-dev/plumar.git"

echo ""
print_info "Target directory: $INSTALL_DIR"

# 2. Clone or Update Repository
if [ -d "$INSTALL_DIR" ]; then
  print_info "Existing installation directory found. Pulling latest changes..."
  cd "$INSTALL_DIR" || exit 1
  if git pull; then
    print_success "Successfully updated repository."
  else
    print_warn "Failed to pull latest changes. Proceeding with existing codebase."
  fi
else
  print_info "Cloning repository from GitHub..."
  if git clone "$REPO_URL" "$INSTALL_DIR"; then
    print_success "Successfully cloned repository."
    cd "$INSTALL_DIR" || exit 1
  else
    print_error "Failed to clone repository from $REPO_URL"
    exit 1
  fi
fi

echo ""
print_info "Installing npm dependencies in local repository..."
if npm install --production; then
  print_success "Dependencies installed successfully."
else
  print_error "Failed to install dependencies."
  exit 1
fi

echo ""
print_info "Triggering global deployment script..."
# Run the existing deploy-global.sh script
chmod +x ./deploy-global.sh

# Run deploy-global with automatic options if possible, or interactive if run in terminal
if [ -t 0 ]; then
  # Standard interactive mode
  ./deploy-global.sh
else
  # Non-interactive fallback: global installation
  print_info "Running in non-interactive mode. Deploying globally..."
  ./deploy-global.sh --global
fi
