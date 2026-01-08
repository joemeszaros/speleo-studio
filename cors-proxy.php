<?php
/**
 * Simple CORS Proxy
 * 
 * Usage: cors-proxy.php?url=https://example.com/api/endpoint
 */

// Set CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Max-Age: 86400');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Get the target URL
$url = $_GET['url'] ?? null;

if (!$url) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Missing required "url" parameter']);
    exit;
}

// Validate URL
if (!filter_var($url, FILTER_VALIDATE_URL)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid URL provided']);
    exit;
}

// Initialize cURL
$ch = curl_init();

// Store response headers separately
$responseHeaders = [];
curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 10,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    CURLOPT_HEADER => false, // Don't include headers in output
    CURLOPT_HEADERFUNCTION => function($curl, $header) use (&$responseHeaders) {
        $len = strlen($header);
        $header = trim($header);
        if (!empty($header)) {
            // Only keep final response headers (reset on new HTTP status)
            if (preg_match('/^HTTP\//', $header)) {
                $responseHeaders = [];
            }
            $responseHeaders[] = $header;
        }
        return $len;
    },
]);

// Forward the request method
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $_SERVER['REQUEST_METHOD']);

// Forward request body for POST/PUT requests
if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH'])) {
    $body = file_get_contents('php://input');
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

// Forward relevant headers
$forwardHeaders = [];
$headersToForward = ['Content-Type', 'Authorization', 'Accept', 'Accept-Language'];

foreach ($headersToForward as $headerName) {
    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $headerName));
    if (isset($_SERVER[$serverKey])) {
        $forwardHeaders[] = "$headerName: " . $_SERVER[$serverKey];
    }
}

// Special case for Content-Type (doesn't have HTTP_ prefix for POST)
if (isset($_SERVER['CONTENT_TYPE'])) {
    $forwardHeaders[] = "Content-Type: " . $_SERVER['CONTENT_TYPE'];
}

if (!empty($forwardHeaders)) {
    curl_setopt($ch, CURLOPT_HTTPHEADER, $forwardHeaders);
}

// Execute the request
$responseBody = curl_exec($ch);

if ($responseBody === false) {
    $error = curl_error($ch);
    curl_close($ch);
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Proxy request failed', 'details' => $error]);
    exit;
}

// Get response info
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);

curl_close($ch);

// Set the content type from the actual response
if ($contentType) {
    header('Content-Type: ' . $contentType);
}

// Set content length for binary data
header('Content-Length: ' . strlen($responseBody));

// Set the response code
http_response_code($httpCode);

// Output the response body
echo $responseBody;

