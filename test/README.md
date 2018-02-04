To launch the test server :

- Buid jobs-react/tests : ```cd <jobs-react tests dir> && tsc``` 
- Build everything : ```tsc```
- Launch databases : ```docker-compose up -d```
- Launch the server : ```cd dist/test && nodemon server.js <jobs-react tests dir>```
