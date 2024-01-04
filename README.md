# YAIID - Yet Another Is It Down Checker

![YAIID image](https://imgur.com/LMVdvNU.png)

YAIID is a simple NodeJS express application that checks whether a URL or IP address is accessible using TCP and ICMP ping. This application can be useful for monitoring the availability of websites or servers.

## Getting Started

To get started with YAIID, you can clone this repository using the following command:

```
git clone https://github.com/altan-me/yaiid
```

After cloning the repository, navigate to the project directory:

```
cd yaiid
```

Install the required dependencies:

```
npm install
```

Finally, start the server:

```
npm start
```

To run with nodemon in Dev/Test use:

```
npm test
```

## How it Works

YAIID uses TCP and ICMP ping to check the availability of a URL or IP address. When you send a request to the server with a URL or IP address, the server pings the address using TCP and ICMP. If the server receives a response from either of these methods, it returns a "200 OK" response indicating that the address is accessible. Otherwise, it returns a "404 Not Found" response.

When a FQDN is provided this tool performs a HEAD request to the server using HTTPS protocol on port 443. It then checks the SSL/TLS certificate associated with the domain and returns various statistics related to the certificate.
This function also detects header response "server" value and will indicate webserver used by endpoint.

## Contributing

Contributions to YAIID are welcome! If you find a bug or have a suggestion for a new feature, please open an issue on this repository. If you'd like to contribute code to YAIID, please fork this repository and submit a pull request.
