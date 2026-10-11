FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY data ./data
RUN npm run check
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
