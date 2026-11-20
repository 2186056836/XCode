// opencode-tls: OpenCode 免费档的 TLS 传输 helper。
//
// 背景：opencode.ai 的匿名免费档按 **TLS 客户端指纹**分额度桶。Node/OpenSSL、
// Chromium(BoringSSL) 与 Go crypto/tls 都会落进 429 桶；只有与官方 CLI 同源的
// Bun(BoringSSL) 指纹能进 200 桶。本进程用 uTLS 复刻 Bun 1.4.4 的真实
// ClientHello（2026-11-20 用本地 CONNECT 代理抓官方 CLI 1.19.4 原始字节对齐：
// TLS 1.3 + X25519MLKEM768 混合 key share，无 GREASE、无 padding），
// 从 stdin 读一个请求、向 stdout 流式写回响应。
//
// 协议（每进程一个请求）：
//
//	stdin 一行 JSON: {method, url, headers: [[name,value],...], body: base64}
//	stdout 一行 JSON: {status, statusText, headers: [[name,value],...]}
//	之后是解压后的响应体字节（已去掉 Content-Encoding / Content-Length /
//	Transfer-Encoding）。
package main

import (
	"bufio"
	"compress/gzip"
	"compress/zlib"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/andybalholm/brotli"
	"github.com/klauspost/compress/zstd"
	utls "github.com/refraction-networking/utls"
)

type requestPayload struct {
	Method  string      `json:"method"`
	URL     string      `json:"url"`
	Headers [][2]string `json:"headers"`
	Body    string      `json:"body"`
}

type responseHeader struct {
	Status     int         `json:"status"`
	StatusText string      `json:"statusText"`
	Headers    [][2]string `json:"headers"`
}

// Bun 1.4.4 抓包：37 字节 cipher suite 列表、13 个 extension、无 GREASE；
// key share 首项是 X25519MLKEM768（1216 字节），随后是 X25519（32 字节），
// 因此 ClientHello 约 1.5KB，和旧版 1.3.14 的 512 字节 padding 形态完全不同。
func main() {
	decoder := json.NewDecoder(bufio.NewReader(os.Stdin))
	var payload requestPayload
	if err := decoder.Decode(&payload); err != nil {
		fail("decode request: " + err.Error())
	}
	if payload.Method == "" {
		payload.Method = "POST"
	}
	parsed, err := url.Parse(payload.URL)
	if err != nil || parsed.Hostname() != "opencode.ai" {
		fail("unsupported url: " + payload.URL)
	}
	body, err := base64.StdEncoding.DecodeString(payload.Body)
	if err != nil {
		fail("decode body: " + err.Error())
	}

	conn, err := dialTLS("opencode.ai:443", "opencode.ai")
	if err != nil {
		fail("tls: " + err.Error())
	}
	defer conn.Close()

	// 请求头顺序与 Bun 1.3.14 抓包一致；忽略调用方可能附带的 host /
	// accept-encoding / content-length，由这里统一重建。
	header := map[string]string{}
	for _, pair := range payload.Headers {
		header[strings.ToLower(pair[0])] = pair[1]
	}
	path := parsed.RequestURI()
	if path == "" {
		path = "/"
	}
	var builder strings.Builder
	builder.WriteString(payload.Method + " " + path + " HTTP/1.1\r\n")
	builder.WriteString("Authorization: " + fallback(header["authorization"], "Bearer public") + "\r\n")
	builder.WriteString("Content-Type: " + fallback(header["content-type"], "application/json") + "\r\n")
	builder.WriteString("User-Agent: " + fallback(header["user-agent"], "opencode/1.19.4 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.4") + "\r\n")
	builder.WriteString("x-opencode-client: " + fallback(header["x-opencode-client"], "cli") + "\r\n")
	builder.WriteString("x-opencode-project: " + fallback(header["x-opencode-project"], "global") + "\r\n")
	if value := header["x-opencode-request"]; value != "" {
		builder.WriteString("x-opencode-request: " + value + "\r\n")
	}
	session := header["x-opencode-session-id"]
	if session == "" {
		session = header["x-opencode-session"]
	}
	if session != "" {
		builder.WriteString("x-opencode-session: " + session + "\r\n")
		builder.WriteString("x-opencode-session-id: " + session + "\r\n")
	}
	builder.WriteString("Connection: keep-alive\r\n")
	builder.WriteString("Accept: */*\r\n")
	builder.WriteString("Host: opencode.ai\r\n")
	builder.WriteString("Accept-Encoding: gzip, deflate, br, zstd\r\n")
	builder.WriteString(fmt.Sprintf("Content-Length: %d\r\n\r\n", len(body)))

	if _, err := io.WriteString(conn, builder.String()); err != nil {
		fail("write headers: " + err.Error())
	}
	if _, err := conn.Write(body); err != nil {
		fail("write body: " + err.Error())
	}

	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, &http.Request{Method: payload.Method})
	if err != nil {
		fail("read response: " + err.Error())
	}
	defer response.Body.Close()

	headers := make([][2]string, 0, len(response.Header))
	for name, values := range response.Header {
		lower := strings.ToLower(name)
		if lower == "content-encoding" || lower == "content-length" || lower == "transfer-encoding" {
			continue
		}
		for _, value := range values {
			headers = append(headers, [2]string{name, value})
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(responseHeader{
		Status:     response.StatusCode,
		StatusText: http.StatusText(response.StatusCode),
		Headers:    headers,
	}); err != nil {
		fail("write response header: " + err.Error())
	}
	os.Stdout.Sync()

	decoded, err := decodeBody(response)
	if err != nil {
		fail("decode response body: " + err.Error())
	}
	if _, err := io.Copy(os.Stdout, decoded); err != nil {
		fail("stream response body: " + err.Error())
	}
}

func fallback(value string, defaults string) string {
	if value == "" {
		return defaults
	}
	return value
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}

// resolveProxy 读取出口代理。显式 OPENCODE_TLS_PROXY 优先，其次标准 HTTPS_PROXY。
// 只支持 HTTP CONNECT：TLS 仍由本进程端到端发起，代理看不到也无法改变 ClientHello。
func resolveProxy() string {
	for _, key := range []string{"OPENCODE_TLS_PROXY", "HTTPS_PROXY", "https_proxy"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

// dialTCP 直连或经 HTTP CONNECT 代理建立到目标的 TCP 隧道。
func dialTCP(address string) (net.Conn, error) {
	proxy := resolveProxy()
	if proxy == "" {
		return net.DialTimeout("tcp", address, 20*time.Second)
	}
	parsed, err := url.Parse(proxy)
	if err != nil {
		return nil, fmt.Errorf("parse proxy: %w", err)
	}
	if parsed.Scheme != "http" {
		return nil, fmt.Errorf("unsupported proxy scheme %q (only http CONNECT)", parsed.Scheme)
	}
	proxyAddress := parsed.Host
	if parsed.Port() == "" {
		proxyAddress = net.JoinHostPort(parsed.Hostname(), "80")
	}
	conn, err := net.DialTimeout("tcp", proxyAddress, 20*time.Second)
	if err != nil {
		return nil, fmt.Errorf("proxy dial: %w", err)
	}
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	var builder strings.Builder
	builder.WriteString("CONNECT " + address + " HTTP/1.1\r\nHost: " + address + "\r\n")
	if parsed.User != nil {
		password, _ := parsed.User.Password()
		credentials := base64.StdEncoding.EncodeToString([]byte(parsed.User.Username() + ":" + password))
		builder.WriteString("Proxy-Authorization: Basic " + credentials + "\r\n")
	}
	builder.WriteString("\r\n")
	if _, err := io.WriteString(conn, builder.String()); err != nil {
		conn.Close()
		return nil, fmt.Errorf("proxy connect: %w", err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), &http.Request{Method: http.MethodConnect})
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("proxy response: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		conn.Close()
		return nil, fmt.Errorf("proxy CONNECT rejected: %s", response.Status)
	}
	// 200 时 ReadResponse 会把 Body 指向隧道本身；不能 Close/读它，否则会破坏隧道。
	_ = conn.SetDeadline(time.Time{})
	return conn, nil
}

func dialTLS(address string, serverName string) (*utls.UConn, error) {
	tcp, err := dialTCP(address)
	if err != nil {
		return nil, err
	}
	spec := &utls.ClientHelloSpec{
		CipherSuites:       []uint16{0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8, 0xc009, 0xc013, 0xc00a, 0xc014, 0x009c, 0x009d, 0x002f, 0x0035},
		CompressionMethods: []uint8{0},
		TLSVersMin:         utls.VersionTLS13,
		TLSVersMax:         utls.VersionTLS13,
		Extensions: []utls.TLSExtension{
			// 官方抓包（Bun 1.4.4 / BoringSSL）的 extension 顺序：
			// 0 SNI → 23 EMS → 65281 renegotiation → 10 groups → 11 points →
			// 35 ticket → 16 ALPN → 5 status_request → 13 sigalgs → 18 SCT →
			// 51 key_share → 45 psk_modes → 43 supported_versions。
			&utls.SNIExtension{ServerName: serverName},
			&utls.GenericExtension{Id: 0x0017, Data: []byte{}},
			&utls.GenericExtension{Id: 0xff01, Data: []byte{0x00}},
			&utls.GenericExtension{Id: 0x000a, Data: []byte{0x00, 0x08, 0x11, 0xec, 0x00, 0x1d, 0x00, 0x17, 0x00, 0x18}},
			&utls.GenericExtension{Id: 0x000b, Data: []byte{0x01, 0x00}},
			&utls.GenericExtension{Id: 0x0023, Data: []byte{}},
			&utls.ALPNExtension{AlpnProtocols: []string{"http/1.1"}},
			&utls.GenericExtension{Id: 0x0005, Data: []byte{0x01, 0x00, 0x00, 0x00, 0x00}},
			&utls.GenericExtension{Id: 0x000d, Data: []byte{
				0x00, 0x16,
				0x04, 0x03, 0x08, 0x04, 0x04, 0x01, 0x05, 0x03, 0x08, 0x05, 0x05, 0x01,
				0x08, 0x06, 0x06, 0x01, 0x08, 0x07, 0x06, 0x03, 0x02, 0x01,
			}},
			&utls.GenericExtension{Id: 0x0012, Data: []byte{}},
			// Data 留空时 uTLS 会为 X25519MLKEM768 生成 ML-KEM 封装密钥 + X25519 公钥。
			&utls.KeyShareExtension{KeyShares: []utls.KeyShare{
				{Group: utls.X25519MLKEM768},
				{Group: utls.X25519},
			}},
			&utls.GenericExtension{Id: 0x002d, Data: []byte{0x01, 0x01}},
			&utls.GenericExtension{Id: 0x002b, Data: []byte{0x04, 0x03, 0x04, 0x03, 0x03}},
		},
	}
	uconn := utls.UClient(tcp, &utls.Config{ServerName: serverName, MinVersion: utls.VersionTLS13, MaxVersion: utls.VersionTLS13}, utls.HelloCustom)
	if err := uconn.ApplyPreset(spec); err != nil {
		tcp.Close()
		return nil, err
	}
	if err := uconn.Handshake(); err != nil {
		tcp.Close()
		return nil, err
	}
	return uconn, nil
}

// 只覆盖 Cloudflare 实际会返回的编码：br / gzip / deflate；identity 原样。
func decodeBody(response *http.Response) (io.Reader, error) {
	switch strings.ToLower(response.Header.Get("Content-Encoding")) {
	case "br":
		return brotli.NewReader(response.Body), nil
	case "gzip", "x-gzip":
		return gzip.NewReader(response.Body)
	case "deflate":
		return zlib.NewReader(response.Body)
	case "zstd":
		return zstd.NewReader(response.Body)
	default:
		return response.Body, nil
	}
}
