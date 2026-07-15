#!/usr/bin/env bash

# ==============================================================================
# plumar-cli Global Deployment & Installation Script
# ==============================================================================
# This script installs plumar-cli globally on your machine, enabling you to use
# the 'plumar' or 'plumar-cli' commands from any directory.
# Supports development linking, clean global installs, and packaging.
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
print_header() {
  clear
  echo -e "${CYAN}${BOLD}======================================================================${NC}"
  echo -e "${PURPLE}${BOLD}             ⚡ plumar-cli GLOBAL BINARY DEPLOYER ⚡             ${NC}"
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

# 1. Prerequisite Verification
check_prerequisites() {
  print_info "Verifying system prerequisites..."
  
  if ! command -v node >/dev/null 2>&1; then
    print_error "Node.js is not installed. Please install Node.js (v22+) to run plumar-cli."
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
    print_error "npm is not installed. Please install npm to proceed."
    exit 1
  fi
  NPM_VER=$(npm -v)
  print_success "npm is available: $NPM_VER"
  echo ""
}

# 2. Make main script executable
make_executable() {
  print_info "Ensuring 'index.js' is marked as executable..."
  if [ -f "index.js" ]; then
    chmod +x index.js
    print_success "'index.js' is now executable."
  else
    print_error "Could not find 'index.js' in the current directory."
    exit 1
  fi
  echo ""
}

# 3. Interactive or automated choice
show_options() {
  echo -e "${BOLD}Select your deployment/installation method:${NC}"
  echo -e "  ${GREEN}1)${NC} ${BOLD}Development Link (npm link)${NC}"
  echo -e "     Best for developers. Symlinks this directory globally so any local edits take effect instantly."
  echo ""
  echo -e "  ${GREEN}2)${NC} ${BOLD}Clean Global Install (npm install -g .)${NC}"
  echo -e "     Installs a copy of the current folder into your global node_modules directory."
  echo ""
  echo -e "  ${GREEN}3)${NC} ${BOLD}Create & Install Distribution Tarball (npm pack + npm install -g <tarball>)${NC}"
  echo -e "     Packs the project into a clean tarball, then installs it globally. Simulates a registry install."
  echo ""
  echo -e "  ${GREEN}4)${NC} ${BOLD}Uninstall plumar-cli (npm uninstall -g plumar-cli)${NC}"
  echo -e "     Removes any globally installed versions or linked folders of plumar-cli."
  echo ""
  echo -e "  ${GREEN}5)${NC} ${BOLD}Exit / Cancel${NC}"
  echo ""
}

verify_install() {
  echo ""
  print_info "Verifying global binary installation..."
  
  # Refresh shell path hash
  hash -r 2>/dev/null || true
  
  # Try checking 'plumar' and 'plumar-cli'
  PLUMAR_BIN_PATH=$(command -v plumar 2>/dev/null)
  PLUMAR_CLI_BIN_PATH=$(command -v plumar-cli 2>/dev/null)
  
  if [ -n "$PLUMAR_BIN_PATH" ] || [ -n "$PLUMAR_CLI_BIN_PATH" ]; then
    print_success "Global command detected!"
    [ -n "$PLUMAR_BIN_PATH" ] && echo -e "   - 'plumar' resolves to: ${CYAN}$PLUMAR_BIN_PATH${NC}"
    [ -n "$PLUMAR_CLI_BIN_PATH" ] && echo -e "   - 'plumar-cli' resolves to: ${CYAN}$PLUMAR_CLI_BIN_PATH${NC}"
    echo ""
    echo -e "${GREEN}${BOLD}🎉 plumar-cli has been successfully deployed globally!${NC}"
    echo -e "You can now start the interactive AI terminal anytime from anywhere by typing:"
    echo -e "   ${CYAN}${BOLD}plumar${NC}   or   ${CYAN}${BOLD}plumar-cli${NC}"
    echo ""
    echo -e "To run it on-demand without installing (or using NPX directly):"
    echo -e "   ${CYAN}${BOLD}npx plumar-cli${NC} (if published/registered) or ${CYAN}${BOLD}npx .${NC} (from the local directory)"
  else
    print_warn "Could not find 'plumar' or 'plumar-cli' in your PATH."
    print_warn "Your global npm binaries folder might not be in your system's PATH."
    print_warn "Run 'npm prefix -g' to find your global prefix, and make sure its 'bin' subdirectory is in your PATH."
    echo -e "Example: ${BOLD}export PATH=\"\$(npm prefix -g)/bin:\$PATH\"${NC} inside your ~/.bashrc or ~/.zshrc"
  fi
}

run_install() {
  local choice=$1
  case $choice in
    1)
      print_info "Executing: npm link"
      if npm link; then
        print_success "npm link completed."
        verify_install
      else
        print_error "npm link failed. You may need to run this script with elevated privileges (sudo), or configure your npm global prefix."
      fi
      ;;
    2)
      print_info "Executing: npm install -g ."
      if npm install -g .; then
        print_success "npm install -g . completed."
        verify_install
      else
        print_error "npm install -g . failed. If you run into permission errors, consider using 'sudo' or configuring npm permissions."
      fi
      ;;
    3)
      print_info "Packing the project..."
      # Use Node.js to extract properties directly from package.json for 100% accuracy
      PKG_NAME=$(node -e "const fs = require('fs'); const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8')); console.log(pkg.name.replace(/^@/, '').replace('/', '-'))")
      PKG_VERSION=$(node -e "const fs = require('fs'); const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8')); console.log(pkg.version)")
      TARBALL_NAME="${PKG_NAME}-${PKG_VERSION}.tgz"

      # Run npm pack to create the tarball
      npm pack > /dev/null 2>&1

      if [ -f "$TARBALL_NAME" ]; then
        print_success "Created distribution package: $TARBALL_NAME"
        print_info "Installing packaged tarball globally..."
        if npm install -g "$TARBALL_NAME"; then
          print_success "Installed from tarball successfully."
          # Clean up local tarball file
          rm "$TARBALL_NAME"
          print_info "Cleaned up temporary package file."
          verify_install
        else
          print_error "Failed to install packaged tarball."
          rm -f "$TARBALL_NAME"
        fi
      else
        print_error "npm pack failed to generate a tarball. Check your system permissions and file presence."
      fi
      ;;
    4)
      print_info "Uninstalling global plumar-cli..."
      npm uninstall -g plumar-cli
      npm unlink plumar-cli 2>/dev/null || true
      print_success "Global plumar-cli packages uninstalled."
      ;;
    5)
      print_info "Deployment cancelled."
      exit 0
      ;;
    *)
      print_error "Invalid option selected."
      ;;
  esac
}

# Main script flow
print_header
check_prerequisites
make_executable

# Check if an argument is passed to script (non-interactive mode)
if [ -n "$1" ]; then
  case "$1" in
    "--link"|"-l"|"link")
      run_install 1
      ;;
    "--global"|"-g"|"global")
      run_install 2
      ;;
    "--pack"|"-p"|"pack")
      run_install 3
      ;;
    "--uninstall"|"-u"|"uninstall")
      run_install 4
      ;;
    *)
      print_error "Unknown argument: $1"
      echo "Usage: $0 [link | global | pack | uninstall]"
      exit 1
      ;;
  esac
else
  # Interactive Mode
  show_options
  read -p "Enter your choice (1-5): " CHOICE
  echo ""
  run_install "$CHOICE"
fi
