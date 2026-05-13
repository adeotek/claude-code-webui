.PHONY: dev dev-backend dev-frontend build lint test install clean run service-install service-uninstall service-test

dev:
	@make -j2 dev-backend dev-frontend

dev-backend:
	cd backend && npm run dev

dev-frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build
	cd backend && npm run build

lint:
	cd backend && npm run lint
	cd frontend && npm run lint

test:
	cd backend && npm test
	cd frontend && npm test

install:
	cd backend && npm install
	cd frontend && npm install

clean:
	rm -rf backend/dist frontend/dist

run:
	@bash run.sh

service-install:
	@bash scripts/install-service.sh $(ARGS)

service-uninstall:
	@bash scripts/uninstall-service.sh

service-test:
	@bash scripts/test-service-install.sh
