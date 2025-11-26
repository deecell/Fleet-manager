# Deecell Fleet Tracking Dashboard

## Overview

The Deecell Fleet Tracking Dashboard is a real-time monitoring system for managing a fleet of clean energy trucks. The application provides comprehensive visibility into truck locations, battery states, performance metrics, and system health. Users can track individual vehicles, view historical performance data, and receive notifications about fleet status changes.

The system is designed as a data-heavy enterprise application with emphasis on clarity, scanability, and operational efficiency. It follows a clean, minimalistic design approach optimized for monitoring and managing fleet operations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React 18 with TypeScript using Vite as the build tool and development server.

**Routing**: Wouter for lightweight client-side routing with a simple dashboard-focused structure.

**State Management**: TanStack React Query (v5) for server state management, caching, and data synchronization. Component-level state managed with React hooks.

**UI Component Library**: Radix UI primitives with shadcn/ui component patterns. The design follows the "new-york" style variant with a system-based approach inspired by Material Design and Carbon Design System.

**Styling**: Tailwind CSS with custom design tokens for colors, spacing, and typography. Uses CSS variables for theming with support for both light and dark modes (currently light mode active). Typography uses Inter font family via Google Fonts for optimal readability.

**Data Visualization**: Recharts for rendering historical performance charts (SOC, voltage, current, watts).

**Map Integration**: Static map image with SVG overlays for truck location visualization, using coordinate transformation for latitude/longitude positioning.

**Form Validation**: React Hook Form with Zod resolvers for type-safe form handling and validation.

### Backend Architecture

**Runtime**: Node.js with Express.js framework for HTTP server and API routing.

**Type Safety**: Full TypeScript implementation shared between client and server via the `/shared` directory for schemas and type definitions.

**API Pattern**: RESTful API structure with routes prefixed with `/api`. Currently uses skeleton route structure ready for implementation.

**Data Validation**: Zod schemas defined in `shared/schema.ts` for runtime type validation and inference, including truck data, historical metrics, and notifications.

**Development Mode**: Vite middleware integration for HMR (Hot Module Replacement) during development with custom error handling and logging.

**Storage Layer**: Abstracted storage interface (`IStorage`) currently implemented with in-memory storage (`MemStorage`). Designed to be swapped with database implementation without changing business logic.

### Data Storage

**Current Implementation**: In-memory storage using JavaScript Maps for development and prototyping.

**Planned Database**: PostgreSQL via Neon serverless driver (`@neondatabase/serverless`). Drizzle ORM configured for schema management and migrations.

**Schema Management**: Drizzle Kit configured to generate migrations from TypeScript schema definitions. Migration output directory: `./migrations`, schema location: `./shared/schema.ts`.

**Session Storage**: Infrastructure in place for PostgreSQL-backed sessions using `connect-pg-simple` package.

**Data Models**:
- **Trucks**: Core fleet entities with real-time metrics (voltage, current, power, SOC, temperature, location)
- **Historical Data**: Time-series performance data points for trend analysis
- **Notifications**: Alert system for fleet events (alerts, warnings, info)
- **Users**: Basic user authentication structure (currently skeleton implementation)

### Design System

**Color Palette**: Neutral-based theme with green primary color (142° hue, 76% saturation) representing clean energy. Custom elevation system using subtle shadows and background overlays.

**Component Patterns**:
- Cards with rounded corners (9px border radius) and subtle shadows
- Hover states with elevation changes (`hover-elevate` class)
- Badge system with status indicators (in-service, not-in-service, notifications)
- Data tables with sortable columns and row selection
- Side panel for detailed truck information with charts

**Spacing System**: Consistent spacing using Tailwind's scale (2, 4, 6, 8 units) for padding, margins, and gaps.

**Responsive Design**: Mobile-first approach with breakpoint-based layouts. Tables and charts adapt to smaller screens, notifications use popovers on mobile.

## External Dependencies

### Core Infrastructure

- **Database**: Neon Serverless PostgreSQL (configured but not yet connected)
- **Drizzle ORM**: Type-safe database queries and schema migrations
- **Express.js**: HTTP server and API framework

### UI and Styling

- **Radix UI**: Headless component primitives for accessibility and customization
- **Tailwind CSS**: Utility-first CSS framework with custom configuration
- **shadcn/ui**: Component patterns and conventions
- **Recharts**: Charting library for data visualization
- **Lucide React**: Icon library

### Development Tools

- **Vite**: Build tool and dev server with HMR support
- **TypeScript**: Type safety across client and server
- **React Query**: Server state management and caching
- **Wouter**: Lightweight routing library

### Form and Validation

- **React Hook Form**: Form state management
- **Zod**: Schema validation and type inference
- **@hookform/resolvers**: Integration between React Hook Form and Zod

### Utilities

- **date-fns**: Date formatting and manipulation
- **clsx + tailwind-merge**: Conditional class name utilities
- **nanoid**: Unique ID generation
- **class-variance-authority**: Type-safe component variants

### Build and Deployment

- **esbuild**: Fast JavaScript bundler for production builds
- **tsx**: TypeScript execution for development server
- **PostCSS + Autoprefixer**: CSS processing pipeline

### Replit-Specific

- **@replit/vite-plugin-runtime-error-modal**: Development error overlay
- **@replit/vite-plugin-cartographer**: Development tooling
- **@replit/vite-plugin-dev-banner**: Development environment indicator