FROM node:20-alpine
RUN apk add --no-cache bash git curl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
