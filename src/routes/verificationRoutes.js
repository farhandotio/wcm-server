import express from 'express';
import {
    getVerifications,
    getVerification,
    createVerification,
    updateVerification,
    deleteVerification
} from '../controllers/verificationController.js';

const router = express.Router();

router.route('/')
    .get(getVerifications)
    .post(createVerification);

router.route('/:id')
    .get(getVerification)
    .put(updateVerification)
    .delete(deleteVerification);

// Eta thik ache - default export
export default router;