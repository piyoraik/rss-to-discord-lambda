.PHONY: help build deploy deploy-guided delete logs validate print-vars

STACK_NAME ?= rss-lambda
AWS_REGION ?= ap-northeast-1
AWS_PROFILE ?=
CAPABILITIES ?= CAPABILITY_IAM
SCHEDULE_EXPRESSION ?= cron(0/15 0-14 * * ? *)
BEDROCK_REGION ?= ap-northeast-1
INFERENCE_PROFILE_ARN ?=
FOUNDATION_MODEL_ID ?= amazon.nova-2-lite-v1:0

SAM ?= sam
SAM_TEMPLATE ?= template.yaml

COMMA := ,
PROFILE_OPT := $(if $(strip $(AWS_PROFILE)),--profile $(AWS_PROFILE),)
INFERENCE_PROFILE_OVERRIDE := $(if $(strip $(INFERENCE_PROFILE_ARN)),ParameterKey=InferenceProfileArn$(COMMA)ParameterValue="$(INFERENCE_PROFILE_ARN)")
PARAM_OVERRIDES = \
	ParameterKey=BedrockRegion,ParameterValue="$(BEDROCK_REGION)" \
	ParameterKey=FoundationModelId,ParameterValue="$(FOUNDATION_MODEL_ID)" \
	ParameterKey=ScheduleExpression,ParameterValue="$(SCHEDULE_EXPRESSION)" \
	$(INFERENCE_PROFILE_OVERRIDE)

help:
	@echo "利用可能なターゲット:"
	@echo "  make build            SAM アプリケーションをビルド"
	@echo "  make deploy-guided    初回向けの guided デプロイ"
	@echo "  make deploy           現在の変数値でデプロイ"
	@echo "  make validate         SAM テンプレートを検証"
	@echo "  make logs             Fetcher Lambda のログを追跡"
	@echo "  make delete           CloudFormation スタックを削除"
	@echo "  make print-vars       現在の変数値を表示"
	@echo ""
	@echo "上書き可能な変数:"
	@echo "  STACK_NAME=$(STACK_NAME)"
	@echo "  AWS_REGION=$(AWS_REGION)"
	@echo "  AWS_PROFILE=$(AWS_PROFILE)"
	@echo "  SCHEDULE_EXPRESSION=$(SCHEDULE_EXPRESSION)"
	@echo "  BEDROCK_REGION=$(BEDROCK_REGION)"
	@echo "  INFERENCE_PROFILE_ARN=$(INFERENCE_PROFILE_ARN)"
	@echo "  FOUNDATION_MODEL_ID=$(FOUNDATION_MODEL_ID)"
	@echo ""
	@echo "実行例:"
	@echo '  make deploy STACK_NAME=my-rss AWS_REGION=ap-northeast-1 INFERENCE_PROFILE_ARN=arn:aws:bedrock:...'

build:
	$(SAM) build --template-file $(SAM_TEMPLATE)

deploy-guided:
	$(SAM) deploy --guided \
		--stack-name $(STACK_NAME) \
		--region $(AWS_REGION) \
		$(PROFILE_OPT) \
		--capabilities $(CAPABILITIES) \
		--resolve-s3 \
		--parameter-overrides $(PARAM_OVERRIDES)

deploy:
	$(SAM) deploy \
		--stack-name $(STACK_NAME) \
		--region $(AWS_REGION) \
		$(PROFILE_OPT) \
		--capabilities $(CAPABILITIES) \
		--resolve-s3 \
		--parameter-overrides $(PARAM_OVERRIDES)

validate:
	$(SAM) validate --template-file $(SAM_TEMPLATE) --region $(AWS_REGION) $(PROFILE_OPT)

logs:
	$(SAM) logs \
		--stack-name $(STACK_NAME) \
		--name RssFetcherFunction \
		--tail \
		--region $(AWS_REGION) \
		$(PROFILE_OPT)

delete:
	$(SAM) delete \
		--stack-name $(STACK_NAME) \
		--region $(AWS_REGION) \
		$(PROFILE_OPT) \
		--no-prompts

print-vars:
	@echo "STACK_NAME=$(STACK_NAME)"
	@echo "AWS_REGION=$(AWS_REGION)"
	@echo "AWS_PROFILE=$(AWS_PROFILE)"
	@echo "CAPABILITIES=$(CAPABILITIES)"
	@echo "SCHEDULE_EXPRESSION=$(SCHEDULE_EXPRESSION)"
	@echo "BEDROCK_REGION=$(BEDROCK_REGION)"
	@echo "INFERENCE_PROFILE_ARN=$(INFERENCE_PROFILE_ARN)"
	@echo "FOUNDATION_MODEL_ID=$(FOUNDATION_MODEL_ID)"
