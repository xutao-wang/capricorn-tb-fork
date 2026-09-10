#!/bin/bash
set -e

PROJECT_ID="onboarding-sandbox-477121"
REGION="us-central1"
DATABASE_ID="capricorn-prod"

echo "============================================================"
echo "Deploying Multimodal Tuberculosis Architecture for Capricorn"
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "Database: $DATABASE_ID"
echo "============================================================"

# Step 1: Seed Tuberculosis & Infectious Disease Specialty into Firestore
echo ""
echo "[Step 1/4] Seeding Tuberculosis Specialty into Firestore..."
gcloud builds submit backend/specialties \
  --project="$PROJECT_ID" \
  --config=backend/specialties/cloudbuild.yaml

# Step 2: Deploy analyze-medical-image Gen2 Cloud Function
echo ""
echo "[Step 2/4] Deploying analyze-medical-image Cloud Function..."
cd backend/capricorn-analyze-image
gcloud functions deploy analyze-medical-image \
  --gen2 \
  --runtime=python312 \
  --region="$REGION" \
  --source=. \
  --entry-point=analyze_image \
  --trigger-http \
  --no-allow-unauthenticated \
  --cpu=1 \
  --memory=2Gi \
  --timeout=3600s \
  --max-instances=100 \
  --min-instances=1 \
  --concurrency=80 \
  --env-vars-file=.env.yaml \
  --project="$PROJECT_ID"
cd ../..

# Allow public invocations for Cloud Run service (browser frontend access)
echo "Granting invoker permissions to analyze-medical-image..."
gcloud run services add-iam-policy-binding analyze-medical-image \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --member="allUsers" \
  --role="roles/run.invoker" || true

# Step 3: Build Frontend Container with Cloud Build
echo ""
echo "[Step 3/4] Building Frontend Container..."
gcloud builds submit frontend \
  --project="$PROJECT_ID" \
  --tag="gcr.io/${PROJECT_ID}/medical-assistant:latest"

# Step 4: Deploy Frontend to Cloud Run
echo ""
echo "[Step 4/4] Deploying medical-assistant to Cloud Run..."
gcloud run deploy medical-assistant \
  --image="gcr.io/${PROJECT_ID}/medical-assistant:latest" \
  --platform=managed \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --no-allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1

gcloud run services add-iam-policy-binding medical-assistant \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --member="allUsers" \
  --role="roles/run.invoker" || true

echo ""
echo "============================================================"
echo "Deployment Complete!"
echo "Medical Assistant URL: https://medical-assistant-djejr2bj2q-uc.a.run.app"
echo "Image Analysis URL:    https://analyze-medical-image-djejr2bj2q-uc.a.run.app"
echo "============================================================"
