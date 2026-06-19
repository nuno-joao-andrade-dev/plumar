#!/bin/bash

# --- Setup Script for Sample Project ---
echo "🚀 Setting up sample_project..."

# 1. Check if directory exists, otherwise exit
if [ ! -d "sample_project" ]; then
    echo "❌ Error: 'sample_project' directory not found. Please run the initial setup steps first."
    exit 1
fi

cd sample_project

# 2. Initialize package.json and install dependencies (Express)
echo ""
echo "📦 Initializing npm and installing express..."
npm init -y > /dev/null 2>&1 # Suppress output for cleaner script execution
npm install express > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "🚨 Error: Failed to install dependencies. Check your network or npm installation."
    cd ..
    exit 1
fi

# 3. Run the server
echo ""
echo "✨ Setup complete! Starting the HTTP server..."
node index.js

# Note: The script will keep running until manually stopped (Ctrl+C).
echo "Press Ctrl+C to stop the server."