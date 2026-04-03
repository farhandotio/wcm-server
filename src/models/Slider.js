import mongoose from 'mongoose';

const sliderSchema = new mongoose.Schema({
    imageUrl: {
        type: String,
        required: true,
    },
    public_id: {
        type: String,
        required: true,
    },
    title: {
        type: String,
        trim: true,
    },
    subTitle: {
        type: String,
        trim: true,
    }
}, { timestamps: true });

const Slider = mongoose.model('Slider', sliderSchema);
export default Slider;