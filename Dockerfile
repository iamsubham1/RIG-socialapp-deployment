FROM ubuntu

# Install dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg curl && \
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get upgrade -y && \
    apt install -y nodejs

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Specify the start command
CMD ["node", "index.js"]
