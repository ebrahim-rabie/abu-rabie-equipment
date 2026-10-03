FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY backend/package*.json ./backend/

# Install dependencies (omit dev dependencies for production)
RUN cd backend && npm ci --omit=dev

# Copy the entire project
COPY . .

# Expose port
EXPOSE 5000

# Start the backend
CMD ["npm", "start", "--prefix", "backend"]