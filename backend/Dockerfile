FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install dependencies (including dev deps so that drizzle-kit is available)
RUN npm ci --omit=optional

# Copy the rest of the backend source code
COPY . .

# Build TypeScript sources
RUN npm run build

# Expose the API port
EXPOSE 3000

# Copy entrypoint and set as container entrypoint
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
