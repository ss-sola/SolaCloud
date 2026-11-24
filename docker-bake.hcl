variable "TAG" {
  default = "local"
}

variable "VITE_GATEWAY_ORIGIN" {
  default = ""
}

group "default" {
  targets = ["backend", "web"]
}

target "common" {
  context    = ".."
  dockerfile = "SolaCloud/docker/Dockerfile"
}

target "backend" {
  inherits = ["common"]
  matrix = {
    service = ["gateway-service", "system-service", "middleware-service", "rag-service", "call-graph-service"]
  }
  name   = service
  target = "service-image"
  args   = { SERVICE = service }
  tags   = ["solacloud/${service}:${TAG}"]
}

target "web" {
  inherits = ["common"]
  target   = "web-image"
  args     = { VITE_GATEWAY_ORIGIN = VITE_GATEWAY_ORIGIN }
  tags     = ["solacloud/web:${TAG}"]
}
