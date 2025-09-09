# mObywatel 3.0

## Overview

mObywatel 3.0 is a Polish ID card simulation web application that mimics the official mObywatel mobile app interface. The project creates a realistic replica of Poland's digital citizen app, featuring document management, QR code functionality, and various citizen services. It's designed as an educational/demonstration tool with Discord integration for user authentication and access control.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The application uses a multi-page HTML structure with vanilla JavaScript and CSS. Key architectural decisions include:

- **Static File Architecture**: All pages are served as static HTML files with shared CSS/JS assets
- **Mobile-First Design**: Responsive design optimized for mobile devices with touch interactions
- **Component-Based Structure**: Reusable UI components with consistent styling through shared CSS files
- **Client-Side Storage**: Uses IndexedDB for local data persistence and localStorage for session management
- **Progressive Web App**: Includes manifest.json for PWA capabilities

### Backend Architecture
The server is built with Express.js and follows a simple API-first approach:

- **Express Server**: Handles static file serving and API endpoints
- **Modular API Structure**: API endpoints organized in separate files for different functionalities
- **Authentication Middleware**: Role-based access control integrated with Discord OAuth
- **Anti-Debug Protection**: Server-side script obfuscation and client-side debugging prevention

### Authentication System
Discord OAuth integration with role-based access control:

- **OAuth Flow**: Users authenticate through Discord OAuth 2.0
- **Role Verification**: Server checks for specific Discord roles before granting access
- **Session Management**: Client stores Discord ID in localStorage for session persistence
- **Access Control**: Auth-check.js module validates user permissions on protected pages

### Database Integration
Supabase is used as the primary database solution:

- **User Management**: Stores Discord user data and assigned roles
- **Key System**: Manages registration keys for access control
- **Session Storage**: Tracks user sessions and permissions

### Security Features
Multiple layers of security implementation:

- **Anti-Debug Protection**: Dynamic script loading with encryption to prevent inspection
- **Context Menu Blocking**: Prevents right-click and developer tools access
- **Keyboard Shortcuts Blocking**: Disables F12, Ctrl+Shift+I, and other debug shortcuts
- **Fingerprinting**: Hardware ID generation for user identification
- **Role-Based Access**: Multi-tier permission system through Discord roles

## External Dependencies

### Third-Party Services
- **Discord API**: OAuth authentication and role management
- **Supabase**: Database as a Service for user data and session management
- **Vercel**: Hosting platform (implied from package configuration)

### JavaScript Libraries
- **@supabase/supabase-js**: Database client library
- **Express.js**: Web server framework  
- **jsonwebtoken**: JWT token handling
- **node-fetch**: HTTP client for server-side requests
- **QR Code Libraries**: jsQR for scanning, qrcodejs for generation
- **IndexedDB**: Browser storage via idb library

### Discord Bot Integration
Separate Discord bot component for user management:
- **discord.js**: Discord API wrapper
- **dotenv**: Environment configuration
- Slash commands for user registration and key management