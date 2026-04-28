FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build
RUN cp -r src/lua dist/lua

CMD ["node", "dist/server.js"]
