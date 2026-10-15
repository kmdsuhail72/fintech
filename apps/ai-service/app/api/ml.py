from fastapi import APIRouter, HTTPException, Request
from app.prometheus import inference

from app.schemas.analysis import AnalysisResponse
from app.schemas.ml import PredictionRequest, TrendPrediction
from app.services.ml_inference import ModelUnavailable, load_model, predict_trend
from app.utils.responses import response

router = APIRouter(prefix="/ml", tags=["experimental ML"])


@router.post("/trend/predict", response_model=AnalysisResponse[TrendPrediction])
def classify_trend(payload: PredictionRequest, request: Request):
    path, digest = request.app.state.ml_model_config
    if not path or not digest:
        raise HTTPException(status_code=503, detail="Experimental trend model is not configured.")
    try:
        artifact = load_model(path, digest)
    except ModelUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    try:
        with inference('trend'):
            return response(predict_trend(payload, artifact), request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
